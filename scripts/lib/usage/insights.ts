import type { Database } from "bun:sqlite";
import { baseModel, type Provider, type Scope, scopeProviders, scopeValue, type UsageUnit, usageUnit, usageUsdEquivalent } from "./pricing.ts";
import { quotaView } from "./quota.ts";
import { type Range, sessions, type SessionSummary } from "./query.ts";

export interface Insight {
  kind: string;
  severity: "info" | "warn";
  text: string;
  data: Record<string, unknown>;
}

export interface InsightsView {
  scope: Scope;
  unit: UsageUnit;
  total_value: number;
  total_usd_equivalent: number;
  insights: Insight[];
}

const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const bigContext = 150_000;
const fanOutAgents = 4;
const fanOutWindowMs = 10 * 60_000;

function amount(provider: Provider, value: number): string {
  const usd = usageUsdEquivalent(provider, value);
  return `$${usd.toFixed(usd >= 100 ? 0 : 2)}${provider === "codex" ? " API-equivalent" : ""}`;
}

export function insights(db: Database, range: Range, now = Date.now(), scope: Scope = "claude"): InsightsView {
  const providerList = scopeProviders(scope);
  const marks = providerList.map(() => "?").join(",");
  // A combined view is priced in API-equivalent dollars, so amounts read the
  // same whichever provider a session belongs to.
  const provider: Provider = scope === "all" ? "claude" : scope;
  const rows = sessions(db, range, scope);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const list: Insight[] = [];
  if (total === 0) return { scope, unit: usageUnit(scope), total_value: 0, total_usd_equivalent: 0, insights: list };

  const top = rows[0]!;
  const topShare = pct(top.value, total);
  if (topShare >= 40 && rows.length > 1) {
    list.push({
      kind: "top_session",
      severity: topShare >= 60 ? "warn" : "info",
      text: `"${top.title}" is ${topShare}% of the attributed usage in this range (${amount(provider, top.value)} of ${amount(provider, total)}).`,
      data: { session_id: top.id, share: topShare, value: top.value },
    });
  }

  const contextRows = db
    .query<{ provider: Provider; big: number; n: number }, [number, number, number, ...Provider[]]>(
      `SELECT provider, COALESCE(SUM(value), 0) AS big, COUNT(*) AS n FROM requests WHERE ts_ms >= ? AND ts_ms < ? AND context > ? AND provider IN (${marks}) GROUP BY provider`,
    )
    .all(range.fromMs, range.toMs, bigContext, ...providerList);
  const context = {
    big: contextRows.reduce((sum, row) => sum + scopeValue(scope, row.provider, row.big), 0),
    n: contextRows.reduce((sum, row) => sum + row.n, 0),
  };
  const contextShare = pct(context.big, total);
  if (contextShare >= 30) {
    list.push({
      kind: "large_context",
      severity: contextShare >= 50 ? "warn" : "info",
      text: `${contextShare}% of attributed usage came from ${context.n} requests carrying more than 150k tokens of context. Shorter threads or earlier compaction will cut this.`,
      data: { share: contextShare, requests: context.n, value: context.big },
    });
  }

  const noCompaction = rows.filter((row) => row.peak_context > 250_000 && row.compactions === 0);
  if (noCompaction.length > 0) {
    const action = noCompaction.every((row) => row.provider === "codex") ? "Start a fresh thread when the previous context no longer helps the task." : "Set autoCompactWindow to 200000 or use /autocompact 200k.";
    list.push({
      kind: "no_compaction",
      severity: "warn",
      text: `${noCompaction.length === 1 ? "One session" : `${noCompaction.length} sessions`} grew past 250k context without compacting: ${noCompaction
        .slice(0, 3)
        .map((row) => `"${row.title}" (${Math.round(row.peak_context / 1000)}k)`)
        .join(", ")}. ${action}`,
      data: { sessions: noCompaction.map((row) => ({ session_id: row.id, peak_context: row.peak_context })) },
    });
  }

  const subValue = rows.reduce((sum, row) => sum + row.sub_value, 0);
  const subShare = pct(subValue, total);
  if (subShare >= 25) {
    const busiest = [...rows].sort((a, b) => b.sub_value - a.sub_value)[0]!;
    list.push({
      kind: "subagents",
      severity: subShare >= 50 ? "warn" : "info",
      text: `Subagents are ${subShare}% of attributed usage (${amount(provider, subValue)}). The heaviest parent is "${busiest.title}" with ${busiest.agents} agents using ${amount(provider, busiest.sub_value)}.`,
      data: { share: subShare, value: subValue, session_id: busiest.id },
    });
  }

  for (const fanOut of fanOutSessions(db, rows, range, scope).slice(0, 3)) {
    list.push({
      kind: "fan_out",
      severity: "warn",
      text: `"${fanOut.session.title}" started ${fanOut.count} subagents within ${Math.max(1, Math.round(fanOut.span_ms / 60_000))} minutes, using ${amount(provider, fanOut.value)}.`,
      data: { session_id: fanOut.session.id, agents: fanOut.count, span_ms: fanOut.span_ms, value: fanOut.value },
    });
  }

  if (providerList.includes("claude")) {
    const inherited = db
      .query<{ n: number; cost: number }, [number, number]>(
        `SELECT COUNT(DISTINCT a.id) AS n, COALESCE(SUM(r.value), 0) AS cost FROM agents a JOIN requests r ON r.provider = a.provider AND r.agent_id = a.id
         WHERE r.provider = 'claude' AND r.ts_ms >= ? AND r.ts_ms < ? AND a.subagent_type IS NOT NULL AND a.model_requested IS NULL
           AND (r.model LIKE 'claude-opus%' OR r.model LIKE 'claude-fable%')`,
      )
      .get(range.fromMs, range.toMs)!;
    if (inherited.n >= 3 && pct(inherited.cost, total) >= 10) {
      list.push({
        kind: "inherited_model",
        severity: "info",
        text: `${inherited.n} subagents ran on Opus or Fable without a model choice, using ${amount(provider, inherited.cost)}. CLAUDE_CODE_SUBAGENT_MODEL=sonnet or a model in the Agent call moves mechanical work to a cheaper model.`,
        data: { agents: inherited.n, value: inherited.cost },
      });
    }
  }

  const byModel = new Map<string, number>();
  for (const row of db
    .query<{ provider: Provider; model: string; cost: number }, [number, number, ...Provider[]]>(
      `SELECT provider, model, COALESCE(SUM(value), 0) AS cost FROM requests WHERE ts_ms >= ? AND ts_ms < ? AND provider IN (${marks}) GROUP BY provider, model`,
    )
    .all(range.fromMs, range.toMs, ...providerList)) {
    const base = baseModel(row.model);
    byModel.set(base, (byModel.get(base) ?? 0) + scopeValue(scope, row.provider, row.cost));
  }
  const mix = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  list.push({
    kind: "model_mix",
    severity: "info",
    text: `Usage by model: ${mix.map(([model, value]) => `${model.replace(/^claude-/, "")} ${pct(value, total)}%`).join(", ")}.`,
    data: { models: Object.fromEntries(mix) },
  });

  if (providerList.includes("codex")) {
    const effort = db
      .query<{ effort: string; value: number }, [number, number]>("SELECT effort, COALESCE(SUM(value), 0) AS value FROM requests WHERE provider = 'codex' AND ts_ms >= ? AND ts_ms < ? AND effort IS NOT NULL GROUP BY effort ORDER BY value DESC")
      .all(range.fromMs, range.toMs)
      .map((row) => ({ effort: row.effort, value: scopeValue(scope, "codex", row.value) }));
    const effortTotal = effort.reduce((sum, row) => sum + row.value, 0);
    if (effort.length > 0) {
      list.push({
        kind: "effort_mix",
        severity: effort.some((row) => ["high", "xhigh", "max", "ultra"].includes(row.effort) && pct(row.value, effortTotal) >= 40) ? "warn" : "info",
        text: `${scope === "all" ? "Codex usage" : "Usage"} by reasoning effort: ${effort.map((row) => `${row.effort} ${pct(row.value, effortTotal)}%`).join(", ")}.`,
        data: { efforts: Object.fromEntries(effort.map((row) => [row.effort, row.value])) },
      });
    }
  }

  for (const window of quotaView(db, now, scope).windows) {
    const share = window.sessions.slice(0, 3);
    const named = share.map((session) => `"${session.title}" ${session.percent_points.toFixed(1)}`).join(", ");
    const explained = share.reduce((sum, session) => sum + session.percent_points, 0);
    list.push({
      kind: "quota_share",
      severity: window.percent >= 80 ? "warn" : "info",
      text:
        `${providerLabel(window.provider)} ${window.label.toLowerCase()} usage is at ${Math.round(window.percent)}%, ` +
        `and ${amount(window.provider, window.local_value)}${window.provider === "codex" ? ` (${window.local_value.toFixed(window.local_value >= 100 ? 0 : 1)} credits)` : ""} of local threads ran in that window. ` +
        `Splitting those points by local spend puts ${explained.toFixed(1)} of them in ${named}. ` +
        `It resets ${new Date(window.end_ms).toISOString().slice(0, 16).replace("T", " ")} UTC. ` +
        `The split assumes local transcripts are the whole window; anything else on the same allowance inflates every share.`,
      data: {
        provider: window.provider,
        kind: window.kind,
        percent: window.percent,
        local_value: window.local_value,
        local_usd_equivalent: window.local_usd_equivalent,
        resets_ms: window.end_ms,
        sessions: share.map((session) => ({ session_id: session.session_id, provider: session.provider, percent_points: session.percent_points, value: session.value })),
      },
    });
    if (window.kind === "five_hour" && window.provider === "claude") {
      list.push({
        kind: "window_rate",
        severity: window.percent >= 80 ? "warn" : "info",
        text: `A full 5-hour window is worth about ${amount("claude", (window.local_value / window.percent) * 100)} at API list prices, going by what this one has cost so far.`,
        data: { percent: window.percent, value: window.local_value, window_value: (window.local_value / window.percent) * 100, resets_ms: window.end_ms },
      });
    }
  }

  return { scope, unit: usageUnit(scope), total_value: total, total_usd_equivalent: scope === "all" ? total : usageUsdEquivalent(provider, total), insights: list };
}

function providerLabel(provider: Provider): string {
  return provider === "claude" ? "Claude" : "Codex";
}

interface FanOut {
  session: SessionSummary;
  count: number;
  span_ms: number;
  value: number;
}

function fanOutSessions(db: Database, rows: SessionSummary[], range: Range, scope: Scope): FanOut[] {
  const result: FanOut[] = [];
  const starts = db.query<{ id: string; started_ms: number }, [Provider, string, number, number]>("SELECT id, started_ms FROM agents WHERE provider = ? AND session_id = ? AND started_ms >= ? AND started_ms < ? ORDER BY started_ms");
  const valueOf = db.query<{ value: number }, [Provider, string]>("SELECT COALESCE(SUM(value), 0) AS value FROM requests WHERE provider = ? AND agent_id = ?");
  for (const session of rows) {
    if (session.agents < fanOutAgents) continue;
    const agents = starts.all(session.provider, session.id, range.fromMs, range.toMs);
    let best: { count: number; span: number; ids: string[] } | undefined;
    for (let index = 0; index < agents.length; index += 1) {
      let end = index;
      while (end + 1 < agents.length && agents[end + 1]!.started_ms - agents[index]!.started_ms <= fanOutWindowMs) end += 1;
      const count = end - index + 1;
      if (count >= fanOutAgents && (!best || count > best.count)) best = { count, span: agents[end]!.started_ms - agents[index]!.started_ms, ids: agents.slice(index, end + 1).map((agent) => agent.id) };
    }
    if (!best) continue;
    const raw = best.ids.reduce((sum, id) => sum + valueOf.get(session.provider, id)!.value, 0);
    result.push({ session, count: best.count, span_ms: best.span, value: scopeValue(scope, session.provider, raw) });
  }
  return result.sort((a, b) => b.value - a.value);
}
