import type { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import { readNewLines, type IngestStats } from "./ingest.ts";
import { ensureLimitTables, type LimitSample } from "./limits.ts";
import { usageValue } from "./pricing.ts";

interface CodexMeta {
  id: string;
  parentId: string | null;
  path: string;
  cwd?: string;
  cliVersion?: string;
  agentNickname?: string;
  agentPath?: string;
  git?: { branch?: string; repository_url?: string };
}

interface CodexState {
  turns: Record<string, { model: string; effort?: string }>;
}

interface RateWindow {
  used_percent?: number | null;
  window_minutes?: number | null;
  resets_at?: number | null;
}

interface RateLimits {
  limit_id?: string | null;
  limit_name?: string | null;
  primary?: RateWindow | null;
  secondary?: RateWindow | null;
  individual_limit?: RateWindow | null;
}

interface Record_ {
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

function parseState(value: string | null | undefined): CodexState | undefined {
  if (!value) return { turns: {} };
  try {
    const parsed = JSON.parse(value) as Partial<CodexState>;
    if (!parsed.turns || typeof parsed.turns !== "object") return undefined;
    return { turns: parsed.turns };
  } catch {
    return undefined;
  }
}

export interface CodexIngestOptions {
  codexDir: string;
  host?: string;
}

function walkJsonl(path: string, files: string[]): void {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) walkJsonl(child, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(child);
  }
}

export function listCodexTranscripts(codexDir: string): string[] {
  const files: string[] = [];
  walkJsonl(resolve(codexDir, "sessions"), files);
  walkJsonl(resolve(codexDir, "archived_sessions"), files);
  return files.sort();
}

function firstLine(path: string): string | undefined {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    while (position < 4 * 1024 * 1024) {
      const chunk = Buffer.alloc(64 * 1024);
      const read = readSync(fd, chunk, 0, chunk.length, position);
      if (read === 0) break;
      const newline = chunk.indexOf(10, 0);
      if (newline >= 0 && newline < read) {
        chunks.push(chunk.subarray(0, newline));
        return Buffer.concat(chunks).toString("utf8");
      }
      chunks.push(chunk.subarray(0, read));
      position += read;
    }
    return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
  } finally {
    closeSync(fd);
  }
}

function transcriptMeta(path: string): CodexMeta | undefined {
  const line = firstLine(path);
  if (!line) return undefined;
  try {
    const record = JSON.parse(line) as Record_;
    if (record.type !== "session_meta" || !record.payload) return undefined;
    const payload = record.payload as {
      id?: string;
      session_id?: string;
      parent_thread_id?: string | null;
      cwd?: string;
      cli_version?: string;
      agent_nickname?: string;
      agent_path?: string;
      git?: CodexMeta["git"];
    };
    const id = payload.id ?? payload.session_id;
    if (!id) return undefined;
    return {
      id,
      parentId: payload.parent_thread_id ?? null,
      path,
      cwd: payload.cwd,
      cliVersion: payload.cli_version,
      agentNickname: payload.agent_nickname,
      agentPath: payload.agent_path,
      git: payload.git,
    };
  } catch {
    return undefined;
  }
}

function timestampMs(timestamp: string | undefined): number | undefined {
  if (!timestamp) return undefined;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : undefined;
}

function textContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const item = part as { type?: string; text?: string };
    if ((item.type === "input_text" || item.type === "text") && item.text) return item.text;
  }
  return undefined;
}

function firstUserPrompt(record: Record_): string | undefined {
  if (record.type !== "response_item" || !record.payload) return undefined;
  const payload = record.payload as { type?: string; role?: string; content?: unknown };
  if (payload.type !== "message" || payload.role !== "user") return undefined;
  const text = textContent(payload.content)?.trim();
  if (!text || text.startsWith("<")) return undefined;
  return text.slice(0, 200);
}

function limitKind(minutes: number, limitId: string, slot: string): { kind: string; label: string } {
  if (minutes === 300) return { kind: limitId === "codex" ? "five_hour" : `five_hour_${limitId}`, label: limitId === "codex" ? "5-hour" : `5-hour ${limitId}` };
  if (minutes === 10_080) return { kind: limitId === "codex" ? "seven_day" : `seven_day_${limitId}`, label: limitId === "codex" ? "Weekly" : `Weekly ${limitId}` };
  return { kind: `${limitId}_${slot}_${minutes}m`, label: `${Math.round(minutes / 60)}-hour ${limitId}` };
}

export function parseCodexLimits(payload: RateLimits): LimitSample[] {
  const samples: LimitSample[] = [];
  const limitId = payload.limit_id?.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "codex";
  for (const [slot, window] of [
    ["primary", payload.primary],
    ["secondary", payload.secondary],
    ["individual", payload.individual_limit],
  ] as const) {
    if (!window || typeof window.used_percent !== "number" || typeof window.window_minutes !== "number") continue;
    const { kind, label } = limitKind(window.window_minutes, limitId, slot);
    const resets = typeof window.resets_at === "number" ? Math.round((window.resets_at * 1000) / 60_000) * 60_000 : null;
    samples.push({ kind, label: payload.limit_name || label, percent: window.used_percent, resets_ms: resets, window_ms: window.window_minutes * 60_000 });
  }
  return samples;
}

function rootId(meta: CodexMeta, byId: Map<string, CodexMeta>): string {
  let current = meta;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) return current.parentId;
    current = parent;
  }
  return current.id;
}

export function ingestCodex(db: Database, options: CodexIngestOptions): IngestStats {
  ensureLimitTables(db);
  const host = options.host ?? hostname();
  const stats: IngestStats = { filesScanned: 0, filesChanged: 0, requestsAdded: 0, failed: [] };
  const metas = listCodexTranscripts(options.codexDir).flatMap((path) => {
    const meta = transcriptMeta(path);
    if (!meta) {
      stats.failed.push({ path, error: "No readable session_meta record" });
      return [];
    }
    return [meta];
  });
  const byId = new Map(metas.map((meta) => [meta.id, meta]));
  const known = new Map(
    db
      .query<{ path: string; size: number; mtime_ms: number; offset: number; state: string | null }, []>("SELECT path, size, mtime_ms, offset, state FROM files WHERE provider = 'codex'")
      .all()
      .map((row) => [row.path, row]),
  );

  const upsertFile = db.query(
    `INSERT INTO files (path, provider, host, project, session_id, agent_id, size, mtime_ms, offset, state)
     VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET project = excluded.project, session_id = excluded.session_id, agent_id = excluded.agent_id,
       size = excluded.size, mtime_ms = excluded.mtime_ms, offset = excluded.offset, state = excluded.state`,
  );
  const upsertSession = db.query(
    `INSERT INTO sessions (provider, id, host, project, cwd, git_branch, version, title, first_prompt, started_ms, ended_ms)
     VALUES ('codex', $id, $host, $project, $cwd, $git_branch, $version, NULL, $first_prompt, $started_ms, $ended_ms)
     ON CONFLICT(provider, id) DO UPDATE SET
       project = CASE WHEN excluded.project <> '' THEN excluded.project ELSE sessions.project END,
       cwd = COALESCE(excluded.cwd, sessions.cwd), git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
       version = COALESCE(excluded.version, sessions.version), first_prompt = COALESCE(sessions.first_prompt, excluded.first_prompt),
       started_ms = MIN(COALESCE(sessions.started_ms, excluded.started_ms), COALESCE(excluded.started_ms, sessions.started_ms)),
       ended_ms = MAX(COALESCE(sessions.ended_ms, excluded.ended_ms), COALESCE(excluded.ended_ms, sessions.ended_ms))`,
  );
  const upsertAgent = db.query(
    `INSERT INTO agents (provider, id, session_id, host, subagent_type, description, prompt_head, started_ms, ended_ms)
     VALUES ('codex', $id, $session_id, $host, $subagent_type, $description, $prompt_head, $started_ms, $ended_ms)
     ON CONFLICT(provider, id) DO UPDATE SET
       session_id = excluded.session_id, subagent_type = COALESCE(agents.subagent_type, excluded.subagent_type),
       description = COALESCE(agents.description, excluded.description), prompt_head = COALESCE(agents.prompt_head, excluded.prompt_head),
       started_ms = MIN(COALESCE(agents.started_ms, excluded.started_ms), COALESCE(excluded.started_ms, agents.started_ms)),
       ended_ms = MAX(COALESCE(agents.ended_ms, excluded.ended_ms), COALESCE(excluded.ended_ms, agents.ended_ms))`,
  );
  const insertRequest = db.query(
    `INSERT OR IGNORE INTO requests
       (provider, host, session_id, agent_id, request_id, ts_ms, model, effort, input, cache_5m, cache_1h, cache_read, output, thinking, context, value)
     VALUES ('codex', $host, $session_id, $agent_id, $request_id, $ts_ms, $model, $effort, $input, 0, 0, $cache_read, $output, $thinking, $context, $value)`,
  );
  const insertEvent = db.query("INSERT INTO events (provider, host, session_id, agent_id, ts_ms, kind, data) VALUES ('codex', ?, ?, ?, ?, ?, ?)");
  const insertLimit = db.query("INSERT OR REPLACE INTO limit_samples (provider, ts_ms, kind, label, percent, resets_ms, window_ms) VALUES ('codex', ?, ?, ?, ?, ?, ?)");
  const deleteRequests = db.query("DELETE FROM requests WHERE provider = 'codex' AND host = ? AND session_id = ? AND agent_id = ?");
  const deleteEvents = db.query("DELETE FROM events WHERE provider = 'codex' AND host = ? AND session_id = ? AND agent_id = ?");

  for (const meta of metas) {
    stats.filesScanned += 1;
    const root = rootId(meta, byId);
    const agentId = meta.parentId ? meta.id : "";
    let stat;
    try {
      stat = statSync(meta.path);
    } catch (error) {
      const message = (error as Error).message;
      stats.failed.push({ path: meta.path, error: message });
      continue;
    }
    const size = stat.size;
    const mtimeMs = Math.round(stat.mtimeMs);
    const previous = known.get(meta.path);
    if (previous && previous.size === size && previous.mtime_ms === mtimeMs) continue;
    let offset = previous?.offset ?? 0;
    let state = parseState(previous?.state);
    const reset = Boolean(previous && (size < previous.offset || !state));
    if (reset) {
      offset = 0;
      state = { turns: {} };
    }
    state ??= { turns: {} };
    stats.filesChanged += 1;
    try {
      const { lines, end } = readNewLines(meta.path, offset, size);
      let firstPrompt: string | undefined;
      let startedMs: number | undefined;
      let endedMs: number | undefined;
      let added = 0;
      let latestLimits: { ts: number; samples: LimitSample[] } | undefined;
      db.transaction(() => {
        if (reset) {
          deleteRequests.run(host, root, agentId);
          deleteEvents.run(host, root, agentId);
        }
        for (const line of lines) {
          let record: Record_;
          try {
            record = JSON.parse(line) as Record_;
          } catch {
            continue;
          }
          const ts = timestampMs(record.timestamp);
          if (ts !== undefined) {
            startedMs = startedMs === undefined ? ts : Math.min(startedMs, ts);
            endedMs = endedMs === undefined ? ts : Math.max(endedMs, ts);
          }
          firstPrompt ??= firstUserPrompt(record);
          if (record.type === "turn_context" && record.payload) {
            const payload = record.payload as { turn_id?: string; model?: string; effort?: string };
            if (payload.turn_id && payload.model) state.turns[payload.turn_id] = { model: payload.model, effort: payload.effort };
            continue;
          }
          if (record.type === "compacted" && ts !== undefined) {
            insertEvent.run(host, root, agentId, ts, "compact", "{}");
            continue;
          }
          if (record.type === "event_msg" && record.payload && (record.payload as { type?: string }).type === "token_count" && ts !== undefined) {
            const rateLimits = (record.payload as { rate_limits?: RateLimits | null }).rate_limits;
            if (rateLimits) latestLimits = { ts, samples: parseCodexLimits(rateLimits) };
            continue;
          }
          if (record.type !== "token_usage_record" || !record.payload || ts === undefined) continue;
          const payload = record.payload as {
            turn_id?: string;
            response_id?: string;
            usage?: { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
          };
          const turn = payload.turn_id ? state.turns[payload.turn_id] : undefined;
          const usage = payload.usage;
          if (!payload.response_id || !turn?.model || !usage) continue;
          const totalInput = usage.input_tokens ?? 0;
          const cached = Math.min(totalInput, usage.cached_input_tokens ?? 0);
          const fresh = Math.max(0, totalInput - cached);
          const output = usage.output_tokens ?? 0;
          const value = usageValue("codex", turn.model, { input: fresh, cache5m: 0, cache1h: 0, cacheRead: cached, output });
          const result = insertRequest.run({
            $host: host,
            $session_id: root,
            $agent_id: agentId,
            $request_id: payload.response_id,
            $ts_ms: ts,
            $model: turn.model,
            $effort: turn.effort ?? null,
            $input: fresh,
            $cache_read: cached,
            $output: output,
            $thinking: usage.reasoning_output_tokens ?? 0,
            $context: totalInput + (usage.cache_write_input_tokens ?? 0),
            $value: value ?? null,
          });
          added += result.changes;
        }
        const project = meta.cwd ? basename(meta.cwd) : "";
        if (agentId === "") {
          upsertSession.run({
            $id: root,
            $host: host,
            $project: project,
            $cwd: meta.cwd ?? null,
            $git_branch: meta.git?.branch ?? null,
            $version: meta.cliVersion ?? null,
            $first_prompt: firstPrompt ?? null,
            $started_ms: startedMs ?? null,
            $ended_ms: endedMs ?? null,
          });
        } else {
          upsertAgent.run({
            $id: meta.id,
            $session_id: root,
            $host: host,
            $subagent_type: meta.agentPath ? basename(meta.agentPath) : null,
            $description: meta.agentNickname ?? null,
            $prompt_head: firstPrompt ?? null,
            $started_ms: startedMs ?? null,
            $ended_ms: endedMs ?? null,
          });
          upsertSession.run({
            $id: root,
            $host: host,
            $project: "",
            $cwd: null,
            $git_branch: null,
            $version: null,
            $first_prompt: null,
            $started_ms: null,
            $ended_ms: null,
          });
        }
        if (latestLimits) {
          for (const sample of latestLimits.samples) insertLimit.run(latestLimits.ts, sample.kind, sample.label, sample.percent, sample.resets_ms, sample.window_ms ?? null);
          db.query(
            `INSERT INTO limit_status (provider, key, value) VALUES ('codex', 'last_poll', ?)
             ON CONFLICT(provider, key) DO UPDATE SET value = excluded.value
             WHERE CAST(json_extract(excluded.value, '$.polled_ms') AS INTEGER) >= CAST(json_extract(limit_status.value, '$.polled_ms') AS INTEGER)`,
          ).run(JSON.stringify({ polled_ms: latestLimits.ts, ok: true }));
        }
        upsertFile.run(meta.path, host, project, root, agentId || null, size, mtimeMs, end, JSON.stringify(state));
      })();
      stats.requestsAdded += added;
    } catch (error) {
      const message = (error as Error).message;
      stats.failed.push({ path: meta.path, error: message });
      console.error(`slopestyle-usage: skipped ${meta.path}: ${message}`);
      upsertFile.run(meta.path, host, meta.cwd ? basename(meta.cwd) : "", root, agentId || null, size, mtimeMs, offset, JSON.stringify(state));
    }
  }
  return stats;
}
