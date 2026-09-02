import type { Database } from "bun:sqlite";
import { unpricedModels } from "./ingest.ts";

export interface Range {
  fromMs: number;
  toMs: number;
}

export type Bucket = "15m" | "hour" | "day";

export const bucketMs: Record<Bucket, number> = { "15m": 15 * 60_000, hour: 3_600_000, day: 86_400_000 };

export interface SessionSummary {
  id: string;
  host: string;
  title: string;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
  cost_usd: number;
  cost_sub_usd: number;
  requests: number;
  requests_sub: number;
  peak_context: number;
  models: Record<string, number>;
  agents: number;
  compactions: number;
}

export interface Timeline {
  bucket: Bucket;
  buckets: number[];
  series: { session_id: string; title: string; values: number[] }[];
  other: number[];
  total_usd: number;
  unpriced_models: string[];
}

// Eight categorical colors exist; everything past them folds into "other".
const topSeries = 8;

function displayTitle(row: { id: string; title: string | null; first_prompt: string | null }): string {
  return row.title ?? row.first_prompt?.replace(/\s+/g, " ").slice(0, 80) ?? row.id.slice(0, 8);
}

// Bucket starts are aligned to the bucket size in the given UTC offset so a
// day bucket starts at local midnight.
export function bucketStarts(range: Range, bucket: Bucket, offsetMinutes: number): number[] {
  const size = bucketMs[bucket];
  const shift = offsetMinutes * 60_000;
  const first = Math.floor((range.fromMs + shift) / size) * size - shift;
  const starts: number[] = [];
  for (let start = first; start < range.toMs; start += size) starts.push(start);
  return starts;
}

export function timeline(db: Database, range: Range, bucket: Bucket, offsetMinutes: number): Timeline {
  const starts = bucketStarts(range, bucket, offsetMinutes);
  const size = bucketMs[bucket];
  const rows = db
    .query<{ session_id: string; ts_ms: number; cost: number }, [number, number]>(
      "SELECT session_id, ts_ms, COALESCE(cost_usd, 0) AS cost FROM requests WHERE ts_ms >= ? AND ts_ms < ?",
    )
    .all(range.fromMs, range.toMs);
  const perSession = new Map<string, number[]>();
  const totals = new Map<string, number>();
  const firstStart = starts[0] ?? range.fromMs;
  for (const row of rows) {
    const index = Math.floor((row.ts_ms - firstStart) / size);
    if (index < 0 || index >= starts.length) continue;
    let values = perSession.get(row.session_id);
    if (!values) {
      values = new Array<number>(starts.length).fill(0);
      perSession.set(row.session_id, values);
    }
    values[index] += row.cost;
    totals.set(row.session_id, (totals.get(row.session_id) ?? 0) + row.cost);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, topSeries).map(([id]) => id);
  const other = new Array<number>(starts.length).fill(0);
  for (const [id, values] of perSession) {
    if (top.includes(id)) continue;
    for (let index = 0; index < values.length; index += 1) other[index] += values[index];
  }
  const titles = new Map<string, string>();
  if (top.length > 0) {
    const placeholders = top.map(() => "?").join(",");
    for (const row of db
      .query<{ id: string; title: string | null; first_prompt: string | null }, string[]>(`SELECT id, title, first_prompt FROM sessions WHERE id IN (${placeholders})`)
      .all(...top)) {
      titles.set(row.id, displayTitle(row));
    }
  }
  let total = 0;
  for (const value of totals.values()) total += value;
  return {
    bucket,
    buckets: starts,
    series: top.map((id) => ({ session_id: id, title: titles.get(id) ?? id.slice(0, 8), values: perSession.get(id)! })),
    other,
    total_usd: total,
    unpriced_models: unpricedModels(db),
  };
}

interface SessionRow {
  id: string;
  host: string;
  title: string | null;
  first_prompt: string | null;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
}

export function sessions(db: Database, range: Range): SessionSummary[] {
  const requestRows = db
    .query<{ session_id: string; agent_id: string; model: string; n: number; cost: number; peak: number }, [number, number]>(
      `SELECT session_id, agent_id, model, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost, MAX(context) AS peak
       FROM requests WHERE ts_ms >= ? AND ts_ms < ? GROUP BY session_id, agent_id, model`,
    )
    .all(range.fromMs, range.toMs);
  const byId = new Map<string, SessionSummary>();
  const agentIds = new Map<string, Set<string>>();
  for (const row of requestRows) {
    let summary = byId.get(row.session_id);
    if (!summary) {
      summary = {
        id: row.session_id,
        host: "",
        title: "",
        project: "",
        cwd: null,
        git_branch: null,
        started_ms: null,
        ended_ms: null,
        cost_usd: 0,
        cost_sub_usd: 0,
        requests: 0,
        requests_sub: 0,
        peak_context: 0,
        models: {},
        agents: 0,
        compactions: 0,
      };
      byId.set(row.session_id, summary);
      agentIds.set(row.session_id, new Set());
    }
    summary.cost_usd += row.cost;
    summary.requests += row.n;
    if (row.agent_id !== "") {
      summary.cost_sub_usd += row.cost;
      summary.requests_sub += row.n;
      agentIds.get(row.session_id)!.add(row.agent_id);
    } else {
      summary.peak_context = Math.max(summary.peak_context, row.peak);
    }
    summary.models[row.model] = (summary.models[row.model] ?? 0) + row.n;
  }
  if (byId.size === 0) return [];
  const ids = [...byId.keys()];
  const placeholders = ids.map(() => "?").join(",");
  for (const row of db.query<SessionRow, string[]>(`SELECT * FROM sessions WHERE id IN (${placeholders})`).all(...ids)) {
    const summary = byId.get(row.id)!;
    summary.host = row.host;
    summary.title = displayTitle(row);
    summary.project = row.project;
    summary.cwd = row.cwd;
    summary.git_branch = row.git_branch;
    summary.started_ms = row.started_ms;
    summary.ended_ms = row.ended_ms;
  }
  for (const row of db
    .query<{ session_id: string; n: number }, [number, number, ...string[]]>(
      `SELECT session_id, COUNT(*) AS n FROM events WHERE kind = 'compact' AND agent_id = '' AND ts_ms >= ? AND ts_ms < ? AND session_id IN (${placeholders}) GROUP BY session_id`,
    )
    .all(range.fromMs, range.toMs, ...ids)) {
    byId.get(row.session_id)!.compactions = row.n;
  }
  for (const [id, set] of agentIds) byId.get(id)!.agents = set.size;
  return [...byId.values()].sort((a, b) => b.cost_usd - a.cost_usd);
}

export interface RequestPoint {
  ts_ms: number;
  agent_id: string;
  model: string;
  context: number;
  input: number;
  cache_5m: number;
  cache_1h: number;
  cache_read: number;
  output: number;
  thinking: number;
  cost_usd: number | null;
}

export interface AgentSummary {
  id: string;
  subagent_type: string | null;
  model_requested: string | null;
  description: string | null;
  prompt_head: string | null;
  started_ms: number | null;
  ended_ms: number | null;
  requests: number;
  cost_usd: number;
  peak_context: number;
  models: Record<string, number>;
}

export interface SessionDetail {
  session: SessionSummary;
  requests: RequestPoint[];
  agents: AgentSummary[];
  events: { ts_ms: number; agent_id: string; kind: string; data: Record<string, unknown> }[];
}

export function sessionDetail(db: Database, id: string, range: Range): SessionDetail | undefined {
  const summary = sessions(db, range).find((row) => row.id === id);
  if (!summary) return undefined;
  const requests = db
    .query<RequestPoint, [string, number, number]>(
      `SELECT ts_ms, agent_id, model, context, input, cache_5m, cache_1h, cache_read, output, thinking, cost_usd
       FROM requests WHERE session_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms`,
    )
    .all(id, range.fromMs, range.toMs);
  const agents = new Map<string, AgentSummary>();
  for (const row of db
    .query<Omit<AgentSummary, "requests" | "cost_usd" | "peak_context" | "models">, [string]>(
      "SELECT id, subagent_type, model_requested, description, prompt_head, started_ms, ended_ms FROM agents WHERE session_id = ?",
    )
    .all(id)) {
    agents.set(row.id, { ...row, requests: 0, cost_usd: 0, peak_context: 0, models: {} });
  }
  for (const request of requests) {
    if (request.agent_id === "") continue;
    const agent = agents.get(request.agent_id);
    if (!agent) continue;
    agent.requests += 1;
    agent.cost_usd += request.cost_usd ?? 0;
    agent.peak_context = Math.max(agent.peak_context, request.context);
    agent.models[request.model] = (agent.models[request.model] ?? 0) + 1;
  }
  const events = db
    .query<{ ts_ms: number; agent_id: string; kind: string; data: string }, [string, number, number]>(
      "SELECT ts_ms, agent_id, kind, data FROM events WHERE session_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
    )
    .all(id, range.fromMs, range.toMs)
    .map((row) => ({ ...row, data: JSON.parse(row.data) as Record<string, unknown> }));
  return {
    session: summary,
    requests,
    agents: [...agents.values()].filter((agent) => agent.requests > 0).sort((a, b) => b.cost_usd - a.cost_usd),
    events,
  };
}
