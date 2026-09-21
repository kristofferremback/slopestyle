import type { Database } from "bun:sqlite";
import { limitsView } from "./limits.ts";
import { type Provider, type Scope, scopeProviders, usageUsdEquivalent } from "./pricing.ts";
import { sessionKey } from "./query.ts";

// Plan limits are reported as one percentage per window, with no breakdown by
// session. Locally indexed transcripts give the other half: what each session
// spent inside that window. Splitting the reported percentage by each session's
// share of the locally attributed spend turns "the week is at 26%" into "this
// thread is 6 of those 26 points".
//
// The split is an estimate, and it assumes local transcripts are the whole
// window. Anything else on the same allowance, chatgpt.com, another machine, a
// plan's own accounting rules, inflates every local share by the same factor.
// Callers say so wherever they print these numbers.

// Model-scoped weekly limits only count some models, so splitting them by every
// session's spend would be wrong. Attribution stays on the plan-wide windows.
const attributableKinds = new Set(["five_hour", "seven_day"]);

export interface QuotaSessionShare {
  session_id: string;
  provider: Provider;
  key: string;
  title: string;
  value: number;
  usd_equivalent: number;
  // Points of the reported utilization this session accounts for. A session
  // holding a third of a window that reads 30% used gets 10 points.
  percent_points: number;
}

export interface QuotaWindow {
  provider: Provider;
  kind: string;
  label: string;
  percent: number;
  start_ms: number;
  end_ms: number;
  resets_ms: number | null;
  // Everything local transcripts attribute to this window, in the provider's
  // own unit, and the same figure in API-equivalent dollars.
  local_value: number;
  local_usd_equivalent: number;
  sessions: QuotaSessionShare[];
}

export interface QuotaView {
  scope: Scope;
  windows: QuotaWindow[];
}

function displayTitle(row: { id: string; title: string | null; first_prompt: string | null }): string {
  return row.title ?? row.first_prompt?.replace(/\s+/g, " ").slice(0, 80) ?? row.id.slice(0, 8);
}

// The current windows for a scope, each split across the sessions that ran in
// it. Windows with no reported utilization or no local spend are dropped: a
// share of nothing tells nobody anything.
export function quotaView(db: Database, now = Date.now(), scope: Scope = "claude", topSessions = 50): QuotaView {
  const windows: QuotaWindow[] = [];
  for (const provider of scopeProviders(scope)) {
    const view = limitsView(db, now - 1, now + 1, now, provider);
    for (const sample of view.latest) {
      if (!attributableKinds.has(sample.kind) || sample.percent <= 0) continue;
      const window = view.windows.find((entry) => entry.kind === sample.kind && entry.current);
      if (!window) continue;
      const rows = db
        .query<{ session_id: string; value: number }, [Provider, number, number]>(
          "SELECT session_id, COALESCE(SUM(value), 0) AS value FROM requests WHERE provider = ? AND ts_ms >= ? AND ts_ms < ? GROUP BY session_id ORDER BY value DESC",
        )
        .all(provider, window.start_ms, window.end_ms);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      if (total <= 0) continue;
      const titles = new Map<string, string>();
      const ids = rows.slice(0, topSessions).map((row) => row.session_id);
      if (ids.length > 0) {
        for (const row of db
          .query<{ id: string; title: string | null; first_prompt: string | null }, [Provider, ...string[]]>(
            `SELECT id, title, first_prompt FROM sessions WHERE provider = ? AND id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(provider, ...ids)) {
          titles.set(row.id, displayTitle(row));
        }
      }
      const sessions = rows.slice(0, topSessions).map((row) => ({
        session_id: row.session_id,
        provider,
        key: sessionKey(provider, row.session_id),
        title: titles.get(row.session_id) ?? row.session_id.slice(0, 8),
        value: row.value,
        usd_equivalent: usageUsdEquivalent(provider, row.value),
        percent_points: (row.value / total) * sample.percent,
      }));
      windows.push({
        provider,
        kind: sample.kind,
        label: sample.label,
        percent: sample.percent,
        start_ms: window.start_ms,
        end_ms: window.end_ms,
        resets_ms: sample.resets_ms,
        local_value: total,
        local_usd_equivalent: usageUsdEquivalent(provider, total),
        sessions,
      });
    }
  }
  return { scope, windows };
}

// The window a session should be measured against in a table: the longest
// plan-wide window that is still running for its provider, which is the one
// that decides how much room is left this week.
export function primaryWindow(windows: QuotaWindow[], provider: Provider): QuotaWindow | undefined {
  return windows.filter((window) => window.provider === provider).sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))[0];
}
