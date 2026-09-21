import type { Database } from "bun:sqlite";
import { unpricedModels } from "./ingest.ts";
import { type Provider, type Scope, scopeProviders, scopeValue, type UsageUnit, usageUnit, usageUsdEquivalent } from "./pricing.ts";

export interface Range {
  fromMs: number;
  toMs: number;
}

export type Bucket = "15m" | "hour" | "day";

export const bucketMs: Record<Bucket, number> = { "15m": 15 * 60_000, hour: 3_600_000, day: 86_400_000 };

export interface SessionSummary {
  id: string;
  provider: Provider;
  host: string;
  title: string;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
  value: number;
  usd_equivalent: number;
  sub_value: number;
  // Input counts every token the model read: fresh, cache writes, and cache reads.
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  requests: number;
  requests_sub: number;
  peak_context: number;
  models: Record<string, number>;
  efforts: Record<string, number>;
  agents: number;
  compactions: number;
}

export interface Timeline {
  bucket: Bucket;
  buckets: number[];
  series: { session_id: string; provider: Provider; title: string; values: number[] }[];
  other: number[];
  scope: Scope;
  unit: UsageUnit;
  total_value: number;
  total_usd_equivalent: number;
  total_input_tokens: number;
  total_output_tokens: number;
  unpriced_models: string[];
}

// Eight categorical colors exist; everything past them folds into "other".
const topSeries = 8;

// A session id is only unique within its provider, so anything that keys
// sessions across providers keys them by both.
export function sessionKey(provider: Provider, id: string): string {
  return `${provider}:${id}`;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

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

export function timeline(db: Database, range: Range, bucket: Bucket, offsetMinutes: number, scope: Scope = "claude"): Timeline {
  const list = scopeProviders(scope);
  const starts = bucketStarts(range, bucket, offsetMinutes);
  const size = bucketMs[bucket];
  const rows = db
    .query<{ provider: Provider; session_id: string; ts_ms: number; cost: number; input_tokens: number; output: number }, [number, number, ...Provider[]]>(
      `SELECT provider, session_id, ts_ms, COALESCE(value, 0) AS cost, input + cache_5m + cache_1h + cache_read AS input_tokens, output
       FROM requests WHERE ts_ms >= ? AND ts_ms < ? AND provider IN (${placeholders(list)})`,
    )
    .all(range.fromMs, range.toMs, ...list);
  const perSession = new Map<string, number[]>();
  const totals = new Map<string, number>();
  const firstStart = starts[0] ?? range.fromMs;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of rows) {
    const index = Math.floor((row.ts_ms - firstStart) / size);
    if (index < 0 || index >= starts.length) continue;
    inputTokens += row.input_tokens;
    outputTokens += row.output;
    const key = sessionKey(row.provider, row.session_id);
    let values = perSession.get(key);
    if (!values) {
      values = new Array<number>(starts.length).fill(0);
      perSession.set(key, values);
    }
    const value = scopeValue(scope, row.provider, row.cost);
    values[index] += value;
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, topSeries).map(([key]) => key);
  const other = new Array<number>(starts.length).fill(0);
  for (const [key, values] of perSession) {
    if (top.includes(key)) continue;
    for (let index = 0; index < values.length; index += 1) other[index] += values[index];
  }
  const titles = new Map<string, string>();
  for (const provider of list) {
    const ids = top.filter((key) => key.startsWith(`${provider}:`)).map((key) => key.slice(provider.length + 1));
    if (ids.length === 0) continue;
    for (const row of db
      .query<{ id: string; title: string | null; first_prompt: string | null }, [Provider, ...string[]]>(`SELECT id, title, first_prompt FROM sessions WHERE provider = ? AND id IN (${placeholders(ids)})`)
      .all(provider, ...ids)) {
      titles.set(sessionKey(provider, row.id), displayTitle(row));
    }
  }
  let total = 0;
  for (const value of totals.values()) total += value;
  const unpriced = new Set<string>();
  for (const provider of list) for (const model of unpricedModels(db, provider)) unpriced.add(model);
  return {
    scope,
    unit: usageUnit(scope),
    bucket,
    buckets: starts,
    series: top.map((key) => {
      const split = key.indexOf(":");
      const provider = key.slice(0, split) as Provider;
      const id = key.slice(split + 1);
      return { session_id: id, provider, title: titles.get(key) ?? id.slice(0, 8), values: perSession.get(key)! };
    }),
    other,
    total_value: total,
    total_usd_equivalent: scope === "all" ? total : usageUsdEquivalent(list[0]!, total),
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    unpriced_models: [...unpriced],
  };
}

interface SessionRow {
  id: string;
  provider: Provider;
  host: string;
  title: string | null;
  first_prompt: string | null;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
}

export function sessions(db: Database, range: Range, scope: Scope = "claude"): SessionSummary[] {
  const list = scopeProviders(scope);
  const requestRows = db
    .query<{ provider: Provider; session_id: string; agent_id: string; model: string; effort: string | null; n: number; cost: number; peak: number; input_tokens: number; cache_read: number; output: number }, [number, number, ...Provider[]]>(
      `SELECT provider, session_id, agent_id, model, effort, COUNT(*) AS n, COALESCE(SUM(value), 0) AS cost, MAX(context) AS peak,
              SUM(input + cache_5m + cache_1h + cache_read) AS input_tokens, SUM(cache_read) AS cache_read, SUM(output) AS output
       FROM requests WHERE ts_ms >= ? AND ts_ms < ? AND provider IN (${placeholders(list)})
       GROUP BY provider, session_id, agent_id, model, effort`,
    )
    .all(range.fromMs, range.toMs, ...list);
  const byKey = new Map<string, SessionSummary>();
  const agentIds = new Map<string, Set<string>>();
  for (const row of requestRows) {
    const key = sessionKey(row.provider, row.session_id);
    let summary = byKey.get(key);
    if (!summary) {
      summary = {
        id: row.session_id,
        provider: row.provider,
        host: "",
        title: "",
        project: "",
        cwd: null,
        git_branch: null,
        started_ms: null,
        ended_ms: null,
        value: 0,
        usd_equivalent: 0,
        sub_value: 0,
        input_tokens: 0,
        cache_read_tokens: 0,
        output_tokens: 0,
        requests: 0,
        requests_sub: 0,
        peak_context: 0,
        models: {},
        efforts: {},
        agents: 0,
        compactions: 0,
      };
      byKey.set(key, summary);
      agentIds.set(key, new Set());
    }
    const value = scopeValue(scope, row.provider, row.cost);
    summary.value += value;
    summary.usd_equivalent += usageUsdEquivalent(row.provider, row.cost);
    summary.input_tokens += row.input_tokens;
    summary.cache_read_tokens += row.cache_read;
    summary.output_tokens += row.output;
    summary.requests += row.n;
    if (row.agent_id !== "") {
      summary.sub_value += value;
      summary.requests_sub += row.n;
      agentIds.get(key)!.add(row.agent_id);
    } else {
      summary.peak_context = Math.max(summary.peak_context, row.peak);
    }
    summary.models[row.model] = (summary.models[row.model] ?? 0) + row.n;
    if (row.effort) summary.efforts[row.effort] = (summary.efforts[row.effort] ?? 0) + row.n;
  }
  if (byKey.size === 0) return [];
  for (const provider of list) {
    const ids = [...byKey.values()].filter((summary) => summary.provider === provider).map((summary) => summary.id);
    if (ids.length === 0) continue;
    for (const row of db.query<SessionRow, [Provider, ...string[]]>(`SELECT * FROM sessions WHERE provider = ? AND id IN (${placeholders(ids)})`).all(provider, ...ids)) {
      const summary = byKey.get(sessionKey(provider, row.id))!;
      summary.host = row.host;
      summary.title = displayTitle(row);
      summary.project = row.project;
      summary.cwd = row.cwd;
      summary.git_branch = row.git_branch;
      summary.started_ms = row.started_ms;
      summary.ended_ms = row.ended_ms;
    }
    for (const row of db
      .query<{ session_id: string; n: number }, [Provider, number, number, ...string[]]>(
        `SELECT session_id, COUNT(*) AS n FROM events WHERE provider = ? AND kind = 'compact' AND agent_id = '' AND ts_ms >= ? AND ts_ms < ? AND session_id IN (${placeholders(ids)}) GROUP BY session_id`,
      )
      .all(provider, range.fromMs, range.toMs, ...ids)) {
      byKey.get(sessionKey(provider, row.session_id))!.compactions = row.n;
    }
  }
  for (const [key, set] of agentIds) byKey.get(key)!.agents = set.size;
  return [...byKey.values()].sort((a, b) => b.value - a.value);
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
  effort: string | null;
  value: number | null;
  usd_equivalent: number;
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
  value: number;
  usd_equivalent: number;
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  peak_context: number;
  models: Record<string, number>;
  efforts: Record<string, number>;
}

export interface SessionDetail {
  session: SessionSummary;
  requests: RequestPoint[];
  agents: AgentSummary[];
  events: { ts_ms: number; agent_id: string; kind: string; data: Record<string, unknown> }[];
}

export function sessionDetail(db: Database, id: string, range: Range, scope: Scope = "claude", provider?: Provider): SessionDetail | undefined {
  const summary = sessions(db, range, scope).find((row) => row.id === id && (provider === undefined || row.provider === provider));
  if (!summary) return undefined;
  const own = summary.provider;
  const requests = db
    .query<Omit<RequestPoint, "usd_equivalent">, [Provider, string, number, number]>(
      `SELECT ts_ms, agent_id, model, effort, context, input, cache_5m, cache_1h, cache_read, output, thinking, value
       FROM requests WHERE provider = ? AND session_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms, agent_id, request_id`,
    )
    .all(own, id, range.fromMs, range.toMs)
    .map((request) => ({ ...request, value: scopeValue(scope, own, request.value ?? 0), usd_equivalent: usageUsdEquivalent(own, request.value ?? 0) }));
  const agents = new Map<string, AgentSummary>();
  for (const row of db
    .query<Omit<AgentSummary, "requests" | "value" | "usd_equivalent" | "input_tokens" | "cache_read_tokens" | "output_tokens" | "peak_context" | "models" | "efforts">, [Provider, string]>(
      "SELECT id, subagent_type, model_requested, description, prompt_head, started_ms, ended_ms FROM agents WHERE provider = ? AND session_id = ?",
    )
    .all(own, id)) {
    agents.set(row.id, { ...row, requests: 0, value: 0, usd_equivalent: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0, peak_context: 0, models: {}, efforts: {} });
  }
  for (const request of requests) {
    if (request.agent_id === "") continue;
    const agent = agents.get(request.agent_id);
    if (!agent) continue;
    agent.requests += 1;
    agent.value += request.value ?? 0;
    agent.usd_equivalent += request.usd_equivalent;
    agent.input_tokens += request.input + request.cache_5m + request.cache_1h + request.cache_read;
    agent.cache_read_tokens += request.cache_read;
    agent.output_tokens += request.output;
    agent.peak_context = Math.max(agent.peak_context, request.context);
    agent.models[request.model] = (agent.models[request.model] ?? 0) + 1;
    if (request.effort) agent.efforts[request.effort] = (agent.efforts[request.effort] ?? 0) + 1;
  }
  const events = db
    .query<{ ts_ms: number; agent_id: string; kind: string; data: string }, [Provider, string, number, number]>(
      "SELECT ts_ms, agent_id, kind, data FROM events WHERE provider = ? AND session_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
    )
    .all(own, id, range.fromMs, range.toMs)
    .map((row) => ({ ...row, data: JSON.parse(row.data) as Record<string, unknown> }));
  return {
    session: summary,
    requests,
    agents: [...agents.values()].filter((agent) => agent.requests > 0).sort((a, b) => b.value - a.value),
    events,
  };
}
