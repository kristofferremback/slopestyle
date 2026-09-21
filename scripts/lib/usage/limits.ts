import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "../core.ts";
import { type Provider, type Scope, scopeProviders } from "./pricing.ts";

// Claude Code's own /usage reads GET /api/oauth/usage with the OAuth token it
// keeps in ~/.claude/.credentials.json (Linux) or the login Keychain (macOS).
// This module reads that token, never refreshes it, and stores each poll as a
// sample so utilization and window resets become a time series.

export const usageEndpoint = "https://api.anthropic.com/api/oauth/usage";

export interface Token {
  accessToken: string;
  expiresAt?: number;
}

export type TokenSource = () => Token | { error: string };

export function credentialsToken(home: string, platform = process.platform): Token | { error: string } {
  let raw: string | undefined;
  if (platform === "darwin") {
    const result = run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], { quiet: true });
    if (result.exitCode !== 0) return { error: `Keychain has no readable "Claude Code-credentials" item: ${result.stderr.trim() || "no output"}` };
    raw = result.stdout.trim();
  } else {
    const path = resolve(home, ".claude/.credentials.json");
    if (!existsSync(path)) return { error: `No Claude Code credentials at ${path}` };
    raw = readFileSync(path, "utf8");
  }
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return { error: "Credentials have no claudeAiOauth.accessToken" };
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt };
  } catch {
    return { error: "Credentials are not valid JSON" };
  }
}

interface LimitEntry {
  utilization?: number | null;
  resets_at?: string | null;
}

interface ScopedLimit {
  kind?: string;
  group?: string;
  percent?: number | null;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

export interface UsagePayload {
  five_hour?: LimitEntry | null;
  seven_day?: LimitEntry | null;
  limits?: ScopedLimit[] | null;
}

export interface LimitSample {
  kind: string;
  label: string;
  percent: number;
  resets_ms: number | null;
  window_ms?: number | null;
}

// Flattens the payload into one sample per limit. Model-scoped weekly limits
// get a kind of their own so each is its own series.
export function parseLimits(payload: UsagePayload): LimitSample[] {
  const samples: LimitSample[] = [];
  const push = (kind: string, label: string, percent: number | null | undefined, resetsAt: string | null | undefined) => {
    if (typeof percent !== "number") return;
    const resets = resetsAt ? Date.parse(resetsAt) : Number.NaN;
    // The API jitters resets_at by milliseconds between polls; windows end on
    // the minute, so rounding keeps one window per reset.
    const window_ms = kind === "five_hour" ? 5 * 3_600_000 : kind.startsWith("seven_day") ? 7 * 86_400_000 : null;
    samples.push({ kind, label, percent, resets_ms: Number.isFinite(resets) ? Math.round(resets / 60_000) * 60_000 : null, window_ms });
  };
  push("five_hour", "5-hour", payload.five_hour?.utilization, payload.five_hour?.resets_at);
  push("seven_day", "Weekly", payload.seven_day?.utilization, payload.seven_day?.resets_at);
  for (const limit of payload.limits ?? []) {
    const model = limit.scope?.model?.display_name;
    if (limit.kind !== "weekly_scoped" || !model) continue;
    push(`seven_day_${model.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, `Weekly ${model}`, limit.percent, limit.resets_at);
  }
  return samples;
}

interface TableColumn {
  name: string;
  dflt_value: string | null;
}

function hasProviderDefault(columns: TableColumn[]): boolean {
  const value = columns.find((column) => column.name === "provider")?.dflt_value;
  return value === "'claude'" || value === '"claude"' || value === "claude";
}

function createLimitTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS limit_samples (
      provider TEXT NOT NULL DEFAULT 'claude', ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
      percent REAL NOT NULL, resets_ms INTEGER, window_ms INTEGER,
      PRIMARY KEY (provider, ts_ms, kind)
    );
    CREATE TABLE IF NOT EXISTS limit_status (
      provider TEXT NOT NULL DEFAULT 'claude', key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (provider, key)
    );
  `);
}

export function ensureLimitTables(db: Database): void {
  // Samples are not derivable from transcripts, so this table lives outside
  // the rebuildable schema. The provider default keeps the previous release's
  // inserts valid during upgrade and rollback.
  const columns = db.query<TableColumn, []>("PRAGMA table_info(limit_samples)").all();
  if (columns.length > 0 && !hasProviderDefault(columns)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const lockedColumns = db.query<TableColumn, []>("PRAGMA table_info(limit_samples)").all();
      if (!hasProviderDefault(lockedColumns)) {
        const providerAware = lockedColumns.some((column) => column.name === "provider");
        const hasStatus = db.query<TableColumn, []>("PRAGMA table_info(limit_status)").all().length > 0;
        db.exec("ALTER TABLE limit_samples RENAME TO limit_samples_previous");
        if (hasStatus) db.exec("ALTER TABLE limit_status RENAME TO limit_status_previous");
        createLimitTables(db);
        if (providerAware) {
          db.exec(`
            INSERT INTO limit_samples (provider, ts_ms, kind, label, percent, resets_ms, window_ms)
              SELECT provider, ts_ms, kind, label, percent, resets_ms, window_ms FROM limit_samples_previous;
          `);
        } else {
          db.exec(`
            INSERT INTO limit_samples (provider, ts_ms, kind, label, percent, resets_ms, window_ms)
            SELECT 'claude', ts_ms, kind, label, percent, resets_ms,
              CASE WHEN kind = 'five_hour' THEN ${5 * 3_600_000} ELSE ${7 * 86_400_000} END
              FROM limit_samples_previous;
          `);
        }
        if (hasStatus) {
          db.exec(
            providerAware
              ? "INSERT INTO limit_status (provider, key, value) SELECT provider, key, value FROM limit_status_previous"
              : "INSERT INTO limit_status (provider, key, value) SELECT 'claude', key, value FROM limit_status_previous",
          );
        }
        db.exec("DROP TABLE limit_samples_previous");
        if (hasStatus) db.exec("DROP TABLE limit_status_previous");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  createLimitTables(db);
}

export interface PollStatus {
  polled_ms: number;
  ok: boolean;
  error?: string;
}

export type Fetcher = (token: string) => Promise<UsagePayload>;

export async function fetchUsage(token: string): Promise<UsagePayload> {
  const response = await fetch(usageEndpoint, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} from ${usageEndpoint}`);
  return (await response.json()) as UsagePayload;
}

export async function pollLimits(db: Database, tokenSource: TokenSource, fetcher: Fetcher = fetchUsage, now = Date.now()): Promise<PollStatus> {
  ensureLimitTables(db);
  const record = (status: PollStatus) => {
    db.query("INSERT OR REPLACE INTO limit_status (provider, key, value) VALUES ('claude', 'last_poll', ?)").run(JSON.stringify(status));
    return status;
  };
  try {
    const token = tokenSource();
    if ("error" in token) return record({ polled_ms: now, ok: false, error: token.error });
    if (token.expiresAt !== undefined && token.expiresAt < now) {
      return record({ polled_ms: now, ok: false, error: "Claude Code's OAuth token has expired; it refreshes the next time Claude Code talks to the API" });
    }
    const samples = parseLimits(await fetcher(token.accessToken));
    const insert = db.query("INSERT OR REPLACE INTO limit_samples (provider, ts_ms, kind, label, percent, resets_ms, window_ms) VALUES ('claude', ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const sample of samples) insert.run(now, sample.kind, sample.label, sample.percent, sample.resets_ms, sample.window_ms ?? null);
    })();
    return record({ polled_ms: now, ok: true });
  } catch (error) {
    return record({ polled_ms: now, ok: false, error: (error as Error).message });
  }
}

export interface LimitWindow {
  provider: Provider;
  kind: string;
  label: string;
  start_ms: number;
  end_ms: number;
  current: boolean;
}

export interface LimitsView {
  status: { provider: Provider; status: PollStatus }[];
  latest: (LimitSample & { provider: Provider; ts_ms: number })[];
  samples: { provider: Provider; ts_ms: number; kind: string; percent: number }[];
  windows: LimitWindow[];
}

// Each distinct reset time seen for a limit marks the end of one window. The
// 5-hour window opens 5 hours before it resets; the weekly ones a week before.
// Samples written before window_ms existed carry it as NULL, so windows are
// keyed by provider, kind and reset time to keep one window per reset.
export function limitsView(db: Database, fromMs: number, toMs: number, now = Date.now(), scope: Scope = "claude"): LimitsView {
  ensureLimitTables(db);
  const list = scopeProviders(scope);
  const marks = list.map(() => "?").join(",");
  const status = db
    .query<{ provider: Provider; value: string }, Provider[]>(`SELECT provider, value FROM limit_status WHERE key = 'last_poll' AND provider IN (${marks})`)
    .all(...list)
    .map((row) => ({ provider: row.provider, status: JSON.parse(row.value) as PollStatus }));
  const latest = db
    .query<LimitSample & { provider: Provider; ts_ms: number }, Provider[]>(
      `SELECT s.provider, s.ts_ms, s.kind, s.label, s.percent, s.resets_ms, s.window_ms FROM limit_samples s
       WHERE s.provider IN (${marks}) AND s.ts_ms = (SELECT MAX(ts_ms) FROM limit_samples WHERE provider = s.provider AND kind = s.kind)
       ORDER BY s.provider, s.kind`,
    )
    .all(...list)
    .filter((sample) => sample.resets_ms === null || sample.resets_ms > now);
  const samples = db
    .query<{ provider: Provider; ts_ms: number; kind: string; percent: number }, [number, number, ...Provider[]]>(
      `SELECT provider, ts_ms, kind, percent FROM limit_samples WHERE ts_ms >= ? AND ts_ms < ? AND provider IN (${marks}) ORDER BY ts_ms`,
    )
    .all(fromMs, toMs, ...list);
  const windows: LimitWindow[] = [];
  for (const row of db
    .query<{ provider: Provider; kind: string; label: string; resets_ms: number; window_ms: number | null }, Provider[]>(
      `SELECT provider, kind, MIN(label) AS label, ((resets_ms + 30000) / 60000) * 60000 AS resets_ms, MAX(window_ms) AS window_ms
       FROM limit_samples WHERE resets_ms IS NOT NULL AND provider IN (${marks})
       GROUP BY provider, kind, ((resets_ms + 30000) / 60000) * 60000 ORDER BY resets_ms`,
    )
    .all(...list)) {
    const length = row.window_ms ?? (row.kind === "five_hour" ? 5 * 3_600_000 : 7 * 86_400_000);
    const start = row.resets_ms - length;
    if (row.resets_ms <= fromMs || start >= toMs) continue;
    windows.push({ provider: row.provider, kind: row.kind, label: row.label, start_ms: start, end_ms: row.resets_ms, current: start <= now && now < row.resets_ms });
  }
  return { status, latest, samples, windows };
}
