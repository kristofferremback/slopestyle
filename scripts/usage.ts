#!/usr/bin/env bun

import { resolve } from "node:path";
import { stateRoot } from "./lib/core.ts";
import { ingest, openUsageDb } from "./lib/usage/ingest.ts";
import { insights } from "./lib/usage/insights.ts";
import { credentialsToken, limitsView } from "./lib/usage/limits.ts";
import { usagePort } from "./lib/usage/port.ts";
import { sessions } from "./lib/usage/query.ts";
import { createServer, parseRange } from "./lib/usage/server.ts";
import { manageService, type ServiceAction, serviceActions } from "./lib/usage/service.ts";
import homepage from "./usage/index.html";

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: slopestyle-usage <command> [options]

Commands:
  serve [--port N] [--projects DIR] [--db PATH] [--host NAME]
      Index Claude Code transcripts and serve the usage page on 127.0.0.1.
      Without --port the port comes from "slopestyle-ports claim usage".
      Polls the plan's 5-hour and weekly limits every two minutes with the
      OAuth token Claude Code keeps in its credentials (--no-limits to skip).
  index [--projects DIR] [--db PATH] [--host NAME]
      Index transcripts without serving.
  report [--from WHEN] [--to WHEN] [--since WHEN] [--json] [--limit N]
      Index, then print spend by session, current limits, and insights for a
      range. WHEN is ISO 8601, unix milliseconds, or a local HH:MM today.
      Defaults to today. --since sets --from and leaves --to at now.
  service install|refresh|status|uninstall
      Keep "serve" running in the login session as a macOS LaunchAgent or a
      systemd user service. The installer refreshes it after every sync.

Defaults:
  --projects  $HOME/.claude/projects
  --db        $HOME/.local/state/slopestyle/usage.sqlite
  --host      this machine's hostname

Costs are API list prices, a proxy for subscription usage.`);
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

function report(): void {
  const db = openUsageDb(options.db);
  ingest(db, { projectsDir: options.projects, host: options.host });
  const params = new URLSearchParams({ tz: String(-new Date().getTimezoneOffset()) });
  const from = whenToMs(options.from);
  const to = whenToMs(options.to);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { range } = parseRange(params);
  const rows = sessions(db, range);
  const limits = limitsView(db, range.fromMs, range.toMs);
  const view = insights(db, range);
  if (options.json) {
    console.log(JSON.stringify({ range, pricing: "API list prices", total_usd: view.total_usd, sessions: rows.slice(0, options.limit), limits, insights: view.insights }, null, 2));
    return;
  }
  const money = (value: number) => `$${value.toFixed(2)}`;
  const time = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  console.log(`${time(range.fromMs)} to ${time(range.toMs)}: ${money(view.total_usd)} at API list prices across ${rows.length} sessions`);
  console.log("");
  for (const row of rows.slice(0, options.limit)) {
    const models = Object.entries(row.models)
      .sort((a, b) => b[1] - a[1])
      .map(([model, n]) => `${model.replace(/^claude-/, "")}×${n}`)
      .join(" ");
    console.log(`${money(row.cost_usd).padStart(8)}  ${row.cost_sub_usd > 0 ? `${money(row.cost_sub_usd)} in ${row.agents} agents`.padEnd(22) : "".padEnd(22)}  ${String(row.requests).padStart(4)} req  peak ${String(Math.round(row.peak_context / 1000)).padStart(4)}k  ${row.title}`);
    console.log(`${"".padStart(8)}  ${row.id}  ${row.project}  ${models}`);
  }
  console.log("");
  if (limits.latest.length > 0) {
    for (const sample of limits.latest) {
      const window = limits.windows.find((entry) => entry.kind === sample.kind && entry.current);
      console.log(`${sample.label}: ${Math.round(sample.percent)}%${sample.resets_ms ? `, resets ${time(sample.resets_ms)}` : ""}${window ? ` (window opened ${time(window.start_ms)})` : ""}`);
    }
  } else if (limits.status?.error) {
    console.log(`Limits: ${limits.status.error}`);
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
    const stats = ingest(db, { projectsDir: options.projects, host: options.host });
    console.log(`Indexed ${stats.filesChanged} changed of ${stats.filesScanned} transcripts, ${stats.requestsAdded} new requests, into ${options.db}`);
    break;
  }
  case "serve": {
    const db = openUsageDb(options.db);
    const port = options.port ?? usagePort();
    const server = createServer({
      db,
      ingest: { projectsDir: options.projects, host: options.host },
      port,
      homepage,
      tokenSource: options.limits ? () => credentialsToken(home) : undefined,
    });
    console.log(`slopestyle-usage serving ${options.projects} at http://127.0.0.1:${server.port}/`);
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
