import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "../core.ts";

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
    samples.push({ kind, label, percent, resets_ms: Number.isFinite(resets) ? Math.round(resets / 60_000) * 60_000 : null });
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

export function ensureLimitTables(db: Database): void {
  // Samples are not derivable from transcripts, so this table lives outside
  // the rebuildable schema.
  db.exec(`
    CREATE TABLE IF NOT EXISTS limit_samples (
      ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, percent REAL NOT NULL, resets_ms INTEGER,
      PRIMARY KEY (ts_ms, kind)
    );
    CREATE TABLE IF NOT EXISTS limit_status (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
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
    db.query("INSERT OR REPLACE INTO limit_status (key, value) VALUES ('last_poll', ?)").run(JSON.stringify(status));
    return status;
  };
  try {
    const token = tokenSource();
    if ("error" in token) return record({ polled_ms: now, ok: false, error: token.error });
    if (token.expiresAt !== undefined && token.expiresAt < now) {
      return record({ polled_ms: now, ok: false, error: "Claude Code's OAuth token has expired; it refreshes the next time Claude Code talks to the API" });
    }
    const samples = parseLimits(await fetcher(token.accessToken));
    const insert = db.query("INSERT OR REPLACE INTO limit_samples (ts_ms, kind, label, percent, resets_ms) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const sample of samples) insert.run(now, sample.kind, sample.label, sample.percent, sample.resets_ms);
    })();
    return record({ polled_ms: now, ok: true });
  } catch (error) {
    return record({ polled_ms: now, ok: false, error: (error as Error).message });
  }
}

export interface LimitWindow {
  kind: string;
  label: string;
  start_ms: number;
  end_ms: number;
  current: boolean;
}

export interface LimitsView {
  status: PollStatus | null;
  latest: (LimitSample & { ts_ms: number })[];
  samples: { ts_ms: number; kind: string; percent: number }[];
  windows: LimitWindow[];
}

const windowLength: Record<string, number> = { five_hour: 5 * 3_600_000 };
const weekMs = 7 * 86_400_000;

// Each distinct reset time seen for a limit marks the end of one window. The
// 5-hour window opens 5 hours before it resets; the weekly ones a week before.
export function limitsView(db: Database, fromMs: number, toMs: number, now = Date.now()): LimitsView {
  ensureLimitTables(db);
  const statusRow = db.query<{ value: string }, []>("SELECT value FROM limit_status WHERE key = 'last_poll'").get();
  const latest = db
    .query<LimitSample & { ts_ms: number }, []>(
      "SELECT s.ts_ms, s.kind, s.label, s.percent, s.resets_ms FROM limit_samples s WHERE s.ts_ms = (SELECT MAX(ts_ms) FROM limit_samples WHERE kind = s.kind) ORDER BY s.kind",
    )
    .all();
  const samples = db
    .query<{ ts_ms: number; kind: string; percent: number }, [number, number]>("SELECT ts_ms, kind, percent FROM limit_samples WHERE ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms")
    .all(fromMs, toMs);
  const windows: LimitWindow[] = [];
  for (const row of db
    .query<{ kind: string; label: string; resets_ms: number }, []>(
      "SELECT DISTINCT kind, label, ((resets_ms + 30000) / 60000) * 60000 AS resets_ms FROM limit_samples WHERE resets_ms IS NOT NULL ORDER BY resets_ms",
    )
    .all()) {
    const length = windowLength[row.kind] ?? weekMs;
    const start = row.resets_ms - length;
    if (row.resets_ms <= fromMs || start >= toMs) continue;
    windows.push({ kind: row.kind, label: row.label, start_ms: start, end_ms: row.resets_ms, current: start <= now && now < row.resets_ms });
  }
  return { status: statusRow ? (JSON.parse(statusRow.value) as PollStatus) : null, latest, samples, windows };
}
