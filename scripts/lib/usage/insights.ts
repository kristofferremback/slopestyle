import type { Database } from "bun:sqlite";
import { limitsView } from "./limits.ts";
import { baseModel } from "./pricing.ts";
import { type Range, sessions, type SessionSummary } from "./query.ts";

// Rule-based reading of a range. Each insight carries the numbers it rests on
// and one sentence for the page and the report; Claude gets the same object.

export interface Insight {
  kind: string;
  severity: "info" | "warn";
  text: string;
  data: Record<string, unknown>;
}

export interface InsightsView {
  total_usd: number;
  insights: Insight[];
}

const usd = (value: number): string => `$${value.toFixed(value >= 100 ? 0 : 2)}`;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const bigContext = 150_000;
const fanOutAgents = 4;
const fanOutWindowMs = 10 * 60_000;
const outlierUsd = 0.5;

export function insights(db: Database, range: Range, now = Date.now()): InsightsView {
  const rows = sessions(db, range);
  const total = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  const list: Insight[] = [];
  if (total === 0) return { total_usd: 0, insights: list };

  const top = rows[0]!;
  const topShare = pct(top.cost_usd, total);
  if (topShare >= 40 && rows.length > 1) {
    list.push({
      kind: "top_session",
      severity: topShare >= 60 ? "warn" : "info",
      text: `"${top.title}" is ${topShare}% of the spend in this range (${usd(top.cost_usd)} of ${usd(total)}).`,
      data: { session_id: top.id, share: topShare, cost_usd: top.cost_usd },
    });
  }

  const context = db
    .query<{ big: number; n: number }, [number, number, number]>("SELECT COALESCE(SUM(cost_usd), 0) AS big, COUNT(*) AS n FROM requests WHERE ts_ms >= ? AND ts_ms < ? AND context > ?")
    .get(range.fromMs, range.toMs, bigContext)!;
  const contextShare = pct(context.big, total);
  if (contextShare >= 30) {
    list.push({
      kind: "large_context",
      severity: contextShare >= 50 ? "warn" : "info",
      text: `${contextShare}% of spend came from ${context.n} requests carrying more than 150k tokens of context. Compacting earlier or running long sessions on a 200k window cuts this.`,
      data: { share: contextShare, requests: context.n, cost_usd: context.big },
    });
  }

  const noCompaction = rows.filter((row) => row.peak_context > 250_000 && row.compactions === 0);
  if (noCompaction.length > 0) {
    list.push({
      kind: "no_compaction",
      severity: "warn",
      text: `${noCompaction.length === 1 ? "One session" : `${noCompaction.length} sessions`} grew past 250k context without compacting: ${noCompaction
        .slice(0, 3)
        .map((row) => `"${row.title}" (${Math.round(row.peak_context / 1000)}k)`)
        .join(", ")}. Set autoCompactWindow to 200000 or use /autocompact 200k.`,
      data: { sessions: noCompaction.map((row) => ({ session_id: row.id, peak_context: row.peak_context })) },
    });
  }

  const subCost = rows.reduce((sum, row) => sum + row.cost_sub_usd, 0);
  const subShare = pct(subCost, total);
  if (subShare >= 25) {
    const busiest = [...rows].sort((a, b) => b.cost_sub_usd - a.cost_sub_usd)[0]!;
    list.push({
      kind: "subagents",
      severity: subShare >= 50 ? "warn" : "info",
      text: `Subagents are ${subShare}% of spend (${usd(subCost)}). The heaviest parent is "${busiest.title}" with ${busiest.agents} agents costing ${usd(busiest.cost_sub_usd)}.`,
      data: { share: subShare, cost_usd: subCost, session_id: busiest.id },
    });
  }

  const fanOuts = fanOutSessions(db, rows, range);
  for (const fanOut of fanOuts.slice(0, 3)) {
    list.push({
      kind: "fan_out",
      severity: "warn",
      text: `"${fanOut.session.title}" started ${fanOut.count} subagents within ${Math.max(1, Math.round(fanOut.span_ms / 60_000))} minutes, costing ${usd(fanOut.cost_usd)}. One agent with a file list usually covers a read-only survey.`,
      data: { session_id: fanOut.session.id, agents: fanOut.count, span_ms: fanOut.span_ms, cost_usd: fanOut.cost_usd },
    });
  }

  const outliers = db
    .query<{ n: number; cost: number; session_id: string | null }, [number, number, number]>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost,
        (SELECT session_id FROM requests r2 WHERE r2.ts_ms >= ? AND r2.ts_ms < ? AND r2.cost_usd > ? GROUP BY session_id ORDER BY SUM(cost_usd) DESC LIMIT 1) AS session_id
       FROM requests WHERE ts_ms >= ?1 AND ts_ms < ?2 AND cost_usd > ?3`,
    )
    .get(range.fromMs, range.toMs, outlierUsd)!;
  if (outliers.n >= 5 && pct(outliers.cost, total) >= 20) {
    const owner = rows.find((row) => row.id === outliers.session_id);
    list.push({
      kind: "expensive_requests",
      severity: "info",
      text: `${outliers.n} requests cost more than ${usd(outlierUsd)} each, ${usd(outliers.cost)} together${owner ? `, mostly in "${owner.title}"` : ""}. Single expensive turns usually mean a huge context on a top-tier model.`,
      data: { requests: outliers.n, cost_usd: outliers.cost, session_id: outliers.session_id },
    });
  }

  const inherited = db
    .query<{ n: number; cost: number }, [number, number]>(
      `SELECT COUNT(DISTINCT a.id) AS n, COALESCE(SUM(r.cost_usd), 0) AS cost FROM agents a JOIN requests r ON r.agent_id = a.id
       WHERE r.ts_ms >= ? AND r.ts_ms < ? AND a.subagent_type IS NOT NULL AND a.model_requested IS NULL AND (r.model LIKE 'claude-opus%' OR r.model LIKE 'claude-fable%')`,
    )
    .get(range.fromMs, range.toMs)!;
  if (inherited.n >= 3 && pct(inherited.cost, total) >= 10) {
    list.push({
      kind: "inherited_model",
      severity: "info",
      text: `${inherited.n} subagents ran on Opus or Fable without a model choice, costing ${usd(inherited.cost)}. CLAUDE_CODE_SUBAGENT_MODEL=sonnet or a model in the Agent call moves mechanical work to a cheaper model.`,
      data: { agents: inherited.n, cost_usd: inherited.cost },
    });
  }

  const byModel = new Map<string, number>();
  for (const row of db
    .query<{ model: string; cost: number }, [number, number]>("SELECT model, COALESCE(SUM(cost_usd), 0) AS cost FROM requests WHERE ts_ms >= ? AND ts_ms < ? GROUP BY model")
    .all(range.fromMs, range.toMs)) {
    const base = baseModel(row.model);
    byModel.set(base, (byModel.get(base) ?? 0) + row.cost);
  }
  const mix = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  list.push({
    kind: "model_mix",
    severity: "info",
    text: `Spend by model: ${mix.map(([model, cost]) => `${model.replace(/^claude-/, "")} ${pct(cost, total)}%`).join(", ")}.`,
    data: { models: Object.fromEntries(mix) },
  });

  const limits = limitsView(db, range.fromMs, range.toMs, now);
  const current = limits.windows.find((window) => window.kind === "five_hour" && window.current);
  const fiveHour = limits.latest.find((sample) => sample.kind === "five_hour");
  if (current && fiveHour && fiveHour.percent > 0) {
    const spend = db.query<{ total: number }, [number, number]>("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM requests WHERE ts_ms >= ? AND ts_ms < ?").get(current.start_ms, current.end_ms)!.total;
    const perPercent = spend / fiveHour.percent;
    list.push({
      kind: "window_rate",
      severity: fiveHour.percent >= 80 ? "warn" : "info",
      text: `The current 5-hour window is at ${Math.round(fiveHour.percent)}% with ${usd(spend)} of API-equivalent spend, so a full window is worth about ${usd(perPercent * 100)}. It resets at ${new Date(current.end_ms).toISOString().slice(11, 16)} UTC.`,
      data: { percent: fiveHour.percent, spend_usd: spend, window_usd: perPercent * 100, resets_ms: current.end_ms },
    });
  }

  return { total_usd: total, insights: list };
}

interface FanOut {
  session: SessionSummary;
  count: number;
  span_ms: number;
  cost_usd: number;
}

function fanOutSessions(db: Database, rows: SessionSummary[], range: Range): FanOut[] {
  const result: FanOut[] = [];
  const starts = db.query<{ id: string; started_ms: number }, [string, number, number]>("SELECT id, started_ms FROM agents WHERE session_id = ? AND started_ms >= ? AND started_ms < ? ORDER BY started_ms");
  const costOf = db.query<{ cost: number }, [string]>("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM requests WHERE agent_id = ?");
  for (const session of rows) {
    if (session.agents < fanOutAgents) continue;
    const agents = starts.all(session.id, range.fromMs, range.toMs);
    let best: { count: number; span: number; ids: string[] } | undefined;
    for (let i = 0; i < agents.length; i += 1) {
      let j = i;
      while (j + 1 < agents.length && agents[j + 1]!.started_ms - agents[i]!.started_ms <= fanOutWindowMs) j += 1;
      const count = j - i + 1;
      if (count >= fanOutAgents && (!best || count > best.count)) {
        best = { count, span: agents[j]!.started_ms - agents[i]!.started_ms, ids: agents.slice(i, j + 1).map((agent) => agent.id) };
      }
    }
    if (!best) continue;
    result.push({ session, count: best.count, span_ms: best.span, cost_usd: best.ids.reduce((sum, id) => sum + costOf.get(id)!.cost, 0) });
  }
  return result.sort((a, b) => b.cost_usd - a.cost_usd);
}
