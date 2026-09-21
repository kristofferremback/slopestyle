import type { Database } from "bun:sqlite";
import { limitsView } from "./limits.ts";
import { baseModel, type Provider, type UsageUnit, usageUnit } from "./pricing.ts";
import { type Range, sessions, type SessionSummary } from "./query.ts";

export interface Insight {
  kind: string;
  severity: "info" | "warn";
  text: string;
  data: Record<string, unknown>;
}

export interface InsightsView {
  provider: Provider;
  unit: UsageUnit;
  total_value: number;
  insights: Insight[];
}

const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const bigContext = 150_000;
const fanOutAgents = 4;
const fanOutWindowMs = 10 * 60_000;

function amount(provider: Provider, value: number): string {
  return provider === "claude" ? `$${value.toFixed(value >= 100 ? 0 : 2)}` : `${value.toFixed(value >= 100 ? 0 : 1)} credits`;
}

export function insights(db: Database, range: Range, now = Date.now(), provider: Provider = "claude"): InsightsView {
  const rows = sessions(db, range, provider);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const list: Insight[] = [];
  if (total === 0) return { provider, unit: usageUnit(provider), total_value: 0, insights: list };

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

  const context = db
    .query<{ big: number; n: number }, [Provider, number, number, number]>("SELECT COALESCE(SUM(value), 0) AS big, COUNT(*) AS n FROM requests WHERE provider = ? AND ts_ms >= ? AND ts_ms < ? AND context > ?")
    .get(provider, range.fromMs, range.toMs, bigContext)!;
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
    const action = provider === "claude" ? "Set autoCompactWindow to 200000 or use /autocompact 200k." : "Start a fresh thread when the previous context no longer helps the task.";
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

  for (const fanOut of fanOutSessions(db, rows, range, provider).slice(0, 3)) {
    list.push({
      kind: "fan_out",
      severity: "warn",
      text: `"${fanOut.session.title}" started ${fanOut.count} subagents within ${Math.max(1, Math.round(fanOut.span_ms / 60_000))} minutes, using ${amount(provider, fanOut.value)}.`,
      data: { session_id: fanOut.session.id, agents: fanOut.count, span_ms: fanOut.span_ms, value: fanOut.value },
    });
  }

  if (provider === "claude") {
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
    .query<{ model: string; cost: number }, [Provider, number, number]>("SELECT model, COALESCE(SUM(value), 0) AS cost FROM requests WHERE provider = ? AND ts_ms >= ? AND ts_ms < ? GROUP BY model")
    .all(provider, range.fromMs, range.toMs)) {
    const base = baseModel(row.model);
    byModel.set(base, (byModel.get(base) ?? 0) + row.cost);
  }
  const mix = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  list.push({
    kind: "model_mix",
    severity: "info",
    text: `Usage by model: ${mix.map(([model, value]) => `${model.replace(/^claude-/, "")} ${pct(value, total)}%`).join(", ")}.`,
    data: { models: Object.fromEntries(mix) },
  });

  if (provider === "codex") {
    const effort = db
      .query<{ effort: string; value: number }, [number, number]>("SELECT effort, COALESCE(SUM(value), 0) AS value FROM requests WHERE provider = 'codex' AND ts_ms >= ? AND ts_ms < ? AND effort IS NOT NULL GROUP BY effort ORDER BY value DESC")
      .all(range.fromMs, range.toMs);
    if (effort.length > 0) {
      list.push({
        kind: "effort_mix",
        severity: effort.some((row) => ["high", "xhigh", "max", "ultra"].includes(row.effort) && pct(row.value, total) >= 40) ? "warn" : "info",
        text: `Usage by reasoning effort: ${effort.map((row) => `${row.effort} ${pct(row.value, total)}%`).join(", ")}.`,
        data: { efforts: Object.fromEntries(effort.map((row) => [row.effort, row.value])) },
      });
    }
  }

  const limits = limitsView(db, range.fromMs, range.toMs, now, provider);
  for (const sample of limits.latest) {
    const window = limits.windows.find((entry) => entry.kind === sample.kind && entry.current);
    if (!window || sample.percent <= 0) continue;
    const local = db
      .query<{ total: number }, [Provider, number, number]>("SELECT COALESCE(SUM(value), 0) AS total FROM requests WHERE provider = ? AND ts_ms >= ? AND ts_ms < ?")
      .get(provider, window.start_ms, window.end_ms)!.total;
    if (provider === "claude" && sample.kind === "five_hour") {
      const perPercent = local / sample.percent;
      list.push({
        kind: "window_rate",
        severity: sample.percent >= 80 ? "warn" : "info",
        text: `The current 5-hour window is at ${Math.round(sample.percent)}% with ${amount(provider, local)} of API-equivalent usage, so a full window is worth about ${amount(provider, perPercent * 100)}. It resets at ${new Date(window.end_ms).toISOString().slice(11, 16)} UTC.`,
        data: { percent: sample.percent, value: local, window_value: perPercent * 100, resets_ms: window.end_ms },
      });
    } else if (provider === "codex") {
      list.push({
        kind: "shared_window",
        severity: sample.percent >= 80 ? "warn" : "info",
        text: `${sample.label} usage is at ${Math.round(sample.percent)}%; ${amount(provider, local)} is attributable to local Codex threads in that window. ChatGPT Work and other shared agentic features may account for the rest.`,
        data: { kind: sample.kind, percent: sample.percent, local_value: local, resets_ms: window.end_ms },
      });
    }
  }

  return { provider, unit: usageUnit(provider), total_value: total, insights: list };
}

interface FanOut {
  session: SessionSummary;
  count: number;
  span_ms: number;
  value: number;
}

function fanOutSessions(db: Database, rows: SessionSummary[], range: Range, provider: Provider): FanOut[] {
  const result: FanOut[] = [];
  const starts = db.query<{ id: string; started_ms: number }, [Provider, string, number, number]>("SELECT id, started_ms FROM agents WHERE provider = ? AND session_id = ? AND started_ms >= ? AND started_ms < ? ORDER BY started_ms");
  const valueOf = db.query<{ value: number }, [Provider, string]>("SELECT COALESCE(SUM(value), 0) AS value FROM requests WHERE provider = ? AND agent_id = ?");
  for (const session of rows) {
    if (session.agents < fanOutAgents) continue;
    const agents = starts.all(provider, session.id, range.fromMs, range.toMs);
    let best: { count: number; span: number; ids: string[] } | undefined;
    for (let index = 0; index < agents.length; index += 1) {
      let end = index;
      while (end + 1 < agents.length && agents[end + 1]!.started_ms - agents[index]!.started_ms <= fanOutWindowMs) end += 1;
      const count = end - index + 1;
      if (count >= fanOutAgents && (!best || count > best.count)) best = { count, span: agents[end]!.started_ms - agents[index]!.started_ms, ids: agents.slice(index, end + 1).map((agent) => agent.id) };
    }
    if (!best) continue;
    result.push({ session, count: best.count, span_ms: best.span, value: best.ids.reduce((sum, id) => sum + valueOf.get(provider, id)!.value, 0) });
  }
  return result.sort((a, b) => b.value - a.value);
}
