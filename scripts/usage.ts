#!/usr/bin/env bun

import { resolve } from "node:path";
import { stateRoot } from "./lib/core.ts";
import { tokenCount } from "./lib/usage/format.ts";
import { ingestCodex } from "./lib/usage/codex.ts";
import { ingest, openUsageDb } from "./lib/usage/ingest.ts";
import { insights } from "./lib/usage/insights.ts";
import { credentialsToken, limitsView } from "./lib/usage/limits.ts";
import { usagePort } from "./lib/usage/port.ts";
import { quotaView } from "./lib/usage/quota.ts";
import { sessions } from "./lib/usage/query.ts";
import { createServer, parseRange } from "./lib/usage/server.ts";
import { type Scope, scopeProviders, usageUnit, usageUsdEquivalent } from "./lib/usage/pricing.ts";
import { manageService, type ServiceAction, serviceActions } from "./lib/usage/service.ts";
import homepage from "./usage/index.html";

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: slopestyle-usage <command> [options]

Commands:
  serve [--port N] [--projects DIR] [--codex-dir DIR] [--db PATH] [--host NAME]
      Index Claude Code and Codex transcripts and serve the usage page on 127.0.0.1.
      Without --port the port comes from "slopestyle-ports claim usage".
      Polls the plan's 5-hour and weekly limits every two minutes with the
      OAuth token Claude Code keeps in its credentials (--no-limits to skip).
  index [--provider claude|codex|all] [--projects DIR] [--codex-dir DIR] [--db PATH] [--host NAME]
      Index transcripts without serving.
  report [--provider claude|codex|all] [--from WHEN] [--to WHEN] [--since WHEN] [--json] [--limit N]
      Index, then print spend by session, current limits, quota shares, and
      insights for a range. WHEN is ISO 8601, unix milliseconds, or a local
      HH:MM today. Defaults to today and to Claude. --provider all covers both
      in API-equivalent dollars. --since sets --from and leaves --to at now.
  service install|refresh|status|uninstall
      Keep "serve" running in the login session as a macOS LaunchAgent or a
      systemd user service. The installer refreshes it after every sync.

Defaults:
  --projects  $HOME/.claude/projects
  --codex-dir $HOME/.codex
  --db        $HOME/.local/state/slopestyle/usage.sqlite
  --host      this machine's hostname

Claude values use API list prices as a proxy. Codex values use OpenAI's
ChatGPT Work and Codex credit rate card.`);
  process.exit(exitCode);
}

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");

const args = process.argv.slice(2);
const command = args.shift();
if (command === "service") {
  const action = args[0];
  if (args.length !== 1 || !(serviceActions as readonly string[]).includes(action)) usage(2, "service needs exactly one of install, refresh, status, or uninstall");
  manageService(action as ServiceAction, home);
  process.exit(0);
}
const options = {
  port: undefined as number | undefined,
  projects: resolve(home, ".claude/projects"),
  codexDir: resolve(home, ".codex"),
  provider: "claude" as Scope,
  db: resolve(stateRoot(home), "usage.sqlite"),
  host: undefined as string | undefined,
  limits: true,
  from: undefined as string | undefined,
  to: undefined as string | undefined,
  json: false,
  limit: 20,
};
for (let index = 0; index < args.length; index += 1) {
  const value = () => {
    const next = args[++index];
    if (next === undefined) usage(2, `${args[index - 1]} needs a value`);
    return next;
  };
  switch (args[index]) {
    case "--port":
      options.port = Number(value());
      if (!Number.isInteger(options.port) || options.port < 0) usage(2, "--port must be a non-negative integer");
      break;
    case "--projects":
      options.projects = resolve(value());
      break;
    case "--codex-dir":
      options.codexDir = resolve(value());
      break;
    case "--provider": {
      const provider = value();
      if (provider !== "claude" && provider !== "codex" && provider !== "all") usage(2, "--provider must be claude, codex, or all");
      options.provider = provider;
      break;
    }
    case "--db":
      options.db = resolve(value());
      break;
    case "--host":
      options.host = value();
      break;
    case "--no-limits":
      options.limits = false;
      break;
    case "--from":
      options.from = value();
      break;
    case "--to":
      options.to = value();
      break;
    case "--since":
      options.from = value();
      options.to = String(Date.now());
      break;
    case "--json":
      options.json = true;
      break;
    case "--limit":
      options.limit = Number(value());
      if (!Number.isInteger(options.limit) || options.limit < 1) usage(2, "--limit must be a positive integer");
      break;
    case "-h":
    case "--help":
      usage(0);
      break;
    default:
      usage(2, `Unknown argument: ${args[index]}`);
  }
}

// "13:00" means that local time today.
function whenToMs(when: string | undefined): string | undefined {
  if (when === undefined) return undefined;
  const clock = when.match(/^(\d{1,2}):(\d{2})$/);
  if (!clock) return when;
  const date = new Date();
  date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
  return String(date.getTime());
}

function indexFor(db: ReturnType<typeof openUsageDb>): { filesScanned: number; filesChanged: number; requestsAdded: number } {
  const list = scopeProviders(options.provider);
  const stats = { filesScanned: 0, filesChanged: 0, requestsAdded: 0 };
  for (const provider of list) {
    const run = provider === "claude" ? ingest(db, { projectsDir: options.projects, host: options.host }) : ingestCodex(db, { codexDir: options.codexDir, host: options.host });
    stats.filesScanned += run.filesScanned;
    stats.filesChanged += run.filesChanged;
    stats.requestsAdded += run.requestsAdded;
  }
  return stats;
}

function report(): void {
  const db = openUsageDb(options.db);
  indexFor(db);
  const params = new URLSearchParams({ tz: String(-new Date().getTimezoneOffset()) });
  const from = whenToMs(options.from);
  const to = whenToMs(options.to);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { range } = parseRange(params);
  const rows = sessions(db, range, options.provider);
  const limits = limitsView(db, range.fromMs, range.toMs, Date.now(), options.provider);
  const view = insights(db, range, Date.now(), options.provider);
  const totalInput = rows.reduce((sum, row) => sum + row.input_tokens, 0);
  const totalOutput = rows.reduce((sum, row) => sum + row.output_tokens, 0);
  const quota = quotaView(db, Date.now(), options.provider);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          provider: options.provider,
          range,
          unit: usageUnit(options.provider),
          pricing: options.provider === "codex" ? "OpenAI credit rate card" : options.provider === "claude" ? "API list prices" : "API-equivalent dollars across both providers",
          total_value: view.total_value,
          total_usd_equivalent: view.total_usd_equivalent,
          total_input_tokens: totalInput,
          total_output_tokens: totalOutput,
          sessions: rows.slice(0, options.limit),
          limits,
          quota,
          insights: view.insights,
        },
        null,
        2,
      ),
    );
    return;
  }
  const money = (value: number) => `$${value.toFixed(2)}`;
  // A single provider reports in its own unit; both together only share
  // API-equivalent dollars, which sessions() has already converted to.
  const amount = (value: number) => money(options.provider === "all" ? value : usageUsdEquivalent(options.provider, value));
  const time = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const credits = options.provider === "codex" ? ` (${view.total_value.toFixed(view.total_value >= 100 ? 0 : 1)} credits)` : "";
  const basis = options.provider === "claude" ? "at API list prices" : `API-equivalent${credits}`;
  console.log(`${time(range.fromMs)} to ${time(range.toMs)}: ${amount(view.total_value)} ${basis}, ${tokenCount(totalInput)} in and ${tokenCount(totalOutput)} out, across ${rows.length} sessions`);
  console.log("");
  for (const row of rows.slice(0, options.limit)) {
    const models = Object.entries(row.models)
      .sort((a, b) => b[1] - a[1])
      .map(([model, n]) => `${model.replace(/^claude-/, "")}×${n}`)
      .join(" ");
    const share = quota.windows
      .filter((window) => window.provider === row.provider)
      .map((window) => {
        const points = window.sessions.find((session) => session.session_id === row.id)?.percent_points ?? 0;
        return points >= 0.05 ? `${points.toFixed(1)} of ${Math.round(window.percent)}% ${window.label.toLowerCase()}` : "";
      })
      .filter(Boolean)
      .join(", ");
    console.log(`${amount(row.value).padStart(8)}  ${row.sub_value > 0 ? `${amount(row.sub_value)} in ${row.agents} agents`.padEnd(22) : "".padEnd(22)}  ${String(row.requests).padStart(4)} req  ${tokenCount(row.input_tokens).padStart(5)} in  ${tokenCount(row.output_tokens).padStart(5)} out  peak ${String(Math.round(row.peak_context / 1000)).padStart(4)}k  ${row.title}`);
    console.log(`${"".padStart(8)}  ${options.provider === "all" ? `${row.provider}  ` : ""}${row.id}  ${row.project}${share ? `  quota ${share}` : ""}  ${models}`);
  }
  console.log("");
  if (limits.latest.length > 0) {
    for (const sample of limits.latest) {
      const window = limits.windows.find((entry) => entry.provider === sample.provider && entry.kind === sample.kind && entry.current);
      console.log(`${options.provider === "all" ? `${sample.provider} ` : ""}${sample.label}: ${Math.round(sample.percent)}%${sample.resets_ms ? `, resets ${time(sample.resets_ms)}` : ""}${window ? ` (window opened ${time(window.start_ms)})` : ""}`);
    }
  } else if (limits.status.some((entry) => entry.status.error)) {
    for (const entry of limits.status.filter((row) => row.status.error)) console.log(`Limits (${entry.provider}): ${entry.status.error}`);
  } else {
    console.log("Limits: no samples yet; run \`slopestyle-usage serve\` to poll them.");
  }
  console.log("");
  for (const insight of view.insights) console.log(`${insight.severity === "warn" ? "!" : "-"} ${insight.text}`);
}

switch (command) {
  case "report":
    report();
    break;
  case "index": {
    const db = openUsageDb(options.db);
    const stats = indexFor(db);
    console.log(`Indexed ${stats.filesChanged} changed of ${stats.filesScanned} transcripts, ${stats.requestsAdded} new requests, into ${options.db}`);
    break;
  }
  case "serve": {
    const db = openUsageDb(options.db);
    const port = options.port ?? usagePort();
    const server = createServer({
      db,
      ingest: { projectsDir: options.projects, host: options.host },
      codex: { codexDir: options.codexDir, host: options.host },
      port,
      homepage,
      tokenSource: options.limits ? () => credentialsToken(home) : undefined,
    });
    console.log(`slopestyle-usage serving Claude and Codex usage at http://127.0.0.1:${server.port}/`);
    break;
  }
  case undefined:
  case "-h":
  case "--help":
    usage(command === undefined ? 2 : 0);
    break;
  default:
    usage(2, `Unknown command: ${command}`);
}
