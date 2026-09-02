import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { costUsd, priceFor } from "./pricing.ts";

export const schemaVersion = "1";

export function openUsageDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  // `report` and `serve` share the file; wait for the other writer instead of failing.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const version = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value;
  if (version !== schemaVersion) {
    for (const table of ["files", "sessions", "agents", "requests", "events"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(`
      CREATE TABLE files (
        path TEXT PRIMARY KEY, host TEXT NOT NULL, project TEXT NOT NULL, session_id TEXT NOT NULL,
        agent_id TEXT, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, offset INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, host TEXT NOT NULL, project TEXT NOT NULL, cwd TEXT, git_branch TEXT, version TEXT,
        title TEXT, first_prompt TEXT, started_ms INTEGER, ended_ms INTEGER
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, host TEXT NOT NULL, subagent_type TEXT, model_requested TEXT,
        description TEXT, prompt_head TEXT, started_ms INTEGER, ended_ms INTEGER
      );
      CREATE INDEX agents_session ON agents(session_id);
      CREATE TABLE requests (
        host TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL DEFAULT '', request_id TEXT NOT NULL,
        ts_ms INTEGER NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL, cache_5m INTEGER NOT NULL,
        cache_1h INTEGER NOT NULL, cache_read INTEGER NOT NULL, output INTEGER NOT NULL, thinking INTEGER NOT NULL,
        context INTEGER NOT NULL, cost_usd REAL,
        PRIMARY KEY (host, session_id, agent_id, request_id)
      );
      CREATE INDEX requests_ts ON requests(ts_ms);
      CREATE INDEX requests_session ON requests(session_id, ts_ms);
      CREATE TABLE events (
        id INTEGER PRIMARY KEY, host TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL DEFAULT '',
        ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX events_session ON events(session_id, ts_ms);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '${schemaVersion}');
    `);
  }
  return db;
}

interface TranscriptFile {
  path: string;
  project: string;
  sessionId: string;
  agentId: string;
}

// Session transcripts are <projects>/<project>/<session>.jsonl; subagent
// transcripts are <projects>/<project>/<session>/subagents/agent-<id>.jsonl.
export function listTranscripts(projectsDir: string): TranscriptFile[] {
  const files: TranscriptFile[] = [];
  if (!existsSync(projectsDir)) return files;
  for (const project of readdirSync(projectsDir)) {
    const projectDir = resolve(projectsDir, project);
    let entries: string[];
    try {
      if (!statSync(projectDir).isDirectory()) continue;
      entries = readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        files.push({ path: resolve(projectDir, entry), project, sessionId: entry.slice(0, -6), agentId: "" });
        continue;
      }
      const subagentsDir = resolve(projectDir, entry, "subagents");
      if (!existsSync(subagentsDir)) continue;
      for (const name of readdirSync(subagentsDir)) {
        if (!name.endsWith(".jsonl") || !name.startsWith("agent-")) continue;
        files.push({ path: resolve(subagentsDir, name), project, sessionId: entry, agentId: name.slice(6, -6) });
      }
    }
  }
  return files;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens_details?: { thinking_tokens?: number };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface Record_ {
  type?: string;
  subtype?: string;
  isMeta?: boolean;
  timestamp?: string;
  requestId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  aiTitle?: string;
  compactMetadata?: Record<string, unknown>;
  message?: { model?: string; role?: string; content?: string | ContentBlock[]; usage?: Usage };
}

export interface IngestStats {
  filesScanned: number;
  filesChanged: number;
  requestsAdded: number;
  failed: { path: string; error: string }[];
}

export interface IngestOptions {
  projectsDir: string;
  host?: string;
}

function firstText(content: string | ContentBlock[] | undefined): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) if (block.type === "text" && typeof block.text === "string") return block.text;
  return undefined;
}

function toMs(timestamp: string | undefined): number | undefined {
  if (!timestamp) return undefined;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : undefined;
}

// A user record is a prompt the person typed when it is not meta (skill loads
// and hook output are meta) and not harness markup. A message relayed from a
// channel is meta and wrapped in a <channel> tag; its body is the prompt.
function promptText(record: Record_): string | undefined {
  const text = firstText(record.message?.content);
  if (!text) return undefined;
  if (text.startsWith("<channel ")) {
    const body = text.slice(text.indexOf(">") + 1).split(/\n\nEarlier in this scratchpad/)[0]!.replace(/<\/channel>\s*$/, "").trim();
    return body || undefined;
  }
  if (record.isMeta || text.startsWith("<")) return undefined;
  return text;
}

const promptHeadLength = 200;

function promptHead(text: string): string {
  return text.slice(0, promptHeadLength);
}

// Reads the bytes of a file from `offset` and returns the complete lines plus
// the offset just past the last newline, so a partially written trailing line
// is retried on the next pass.
function readNewLines(path: string, offset: number, size: number): { lines: string[]; end: number } {
  if (size <= offset) return { lines: [], end: offset };
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    let read = 0;
    while (read < buffer.length) {
      const chunk = readSync(fd, buffer, read, buffer.length - read, offset + read);
      if (chunk === 0) break;
      read += chunk;
    }
    const lastNewline = buffer.lastIndexOf(10, read - 1);
    if (lastNewline < 0) return { lines: [], end: offset };
    const text = buffer.toString("utf8", 0, lastNewline + 1);
    return { lines: text.split("\n").filter((line) => line.length > 0), end: offset + lastNewline + 1 };
  } finally {
    closeSync(fd);
  }
}

export function ingest(db: Database, options: IngestOptions): IngestStats {
  const host = options.host ?? hostname();
  const stats: IngestStats = { filesScanned: 0, filesChanged: 0, requestsAdded: 0, failed: [] };
  const known = new Map<string, { size: number; mtime_ms: number; offset: number }>();
  for (const row of db.query<{ path: string; size: number; mtime_ms: number; offset: number }, []>("SELECT path, size, mtime_ms, offset FROM files").all()) {
    known.set(row.path, row);
  }

  const upsertFile = db.query(
    `INSERT INTO files (path, host, project, session_id, agent_id, size, mtime_ms, offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, offset = excluded.offset`,
  );
  const deleteFileRows = [
    db.query("DELETE FROM requests WHERE host = ? AND session_id = ? AND agent_id = ?"),
    db.query("DELETE FROM events WHERE host = ? AND session_id = ? AND agent_id = ?"),
  ];
  const upsertSession = db.query(
    `INSERT INTO sessions (id, host, project, cwd, git_branch, version, title, first_prompt, started_ms, ended_ms)
     VALUES ($id, $host, $project, $cwd, $git_branch, $version, $title, $first_prompt, $started_ms, $ended_ms)
     ON CONFLICT(id) DO UPDATE SET
       cwd = COALESCE(excluded.cwd, sessions.cwd), git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
       version = COALESCE(excluded.version, sessions.version), title = COALESCE(excluded.title, sessions.title),
       first_prompt = COALESCE(sessions.first_prompt, excluded.first_prompt),
       started_ms = MIN(COALESCE(sessions.started_ms, excluded.started_ms), COALESCE(excluded.started_ms, sessions.started_ms)),
       ended_ms = MAX(COALESCE(sessions.ended_ms, excluded.ended_ms), COALESCE(excluded.ended_ms, sessions.ended_ms))`,
  );
  const upsertAgent = db.query(
    `INSERT INTO agents (id, session_id, host, prompt_head, started_ms, ended_ms) VALUES ($id, $session_id, $host, $prompt_head, $started_ms, $ended_ms)
     ON CONFLICT(id) DO UPDATE SET
       prompt_head = COALESCE(agents.prompt_head, excluded.prompt_head),
       started_ms = MIN(COALESCE(agents.started_ms, excluded.started_ms), COALESCE(excluded.started_ms, agents.started_ms)),
       ended_ms = MAX(COALESCE(agents.ended_ms, excluded.ended_ms), COALESCE(excluded.ended_ms, agents.ended_ms))`,
  );
  const insertRequest = db.query(
    `INSERT OR IGNORE INTO requests (host, session_id, agent_id, request_id, ts_ms, model, input, cache_5m, cache_1h, cache_read, output, thinking, context, cost_usd)
     VALUES ($host, $session_id, $agent_id, $request_id, $ts_ms, $model, $input, $cache_5m, $cache_1h, $cache_read, $output, $thinking, $context, $cost_usd)`,
  );
  const insertEvent = db.query("INSERT INTO events (host, session_id, agent_id, ts_ms, kind, data) VALUES (?, ?, ?, ?, ?, ?)");

  const files = listTranscripts(options.projectsDir);
  // Parent transcripts first so agent calls exist before subagent rows link to them.
  files.sort((a, b) => (a.agentId === "" ? 0 : 1) - (b.agentId === "" ? 0 : 1) || a.path.localeCompare(b.path));

  const ingestFile = db.transaction((file: TranscriptFile, size: number, mtimeMs: number, offset: number) => {
    const { lines, end } = readNewLines(file.path, offset, size);
    let firstPrompt: string | undefined;
    let title: string | undefined;
    let cwd: string | undefined;
    let gitBranch: string | undefined;
    let version: string | undefined;
    let startedMs: number | undefined;
    let endedMs: number | undefined;
    let added = 0;
    const seenRequests = new Set<string>();
    for (const line of lines) {
      let record: Record_;
      try {
        record = JSON.parse(line) as Record_;
      } catch {
        continue;
      }
      if (typeof record !== "object" || record === null) continue;
      const ts = toMs(record.timestamp);
      if (ts !== undefined) {
        startedMs = startedMs === undefined ? ts : Math.min(startedMs, ts);
        endedMs = endedMs === undefined ? ts : Math.max(endedMs, ts);
      }
      cwd ??= record.cwd;
      gitBranch ??= record.gitBranch;
      version ??= record.version;
      if (record.type === "ai-title" && typeof record.aiTitle === "string") title = record.aiTitle;
      if (record.type === "user") {
        if (firstPrompt === undefined) firstPrompt = promptText(record);
        continue;
      }
      if (record.type === "system" && record.subtype === "compact_boundary" && ts !== undefined) {
        insertEvent.run(host, file.sessionId, file.agentId, ts, "compact", JSON.stringify(record.compactMetadata ?? {}));
        continue;
      }
      if (record.type !== "assistant" || ts === undefined) continue;
      const message = record.message;
      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        if (block.type !== "tool_use" || !block.input) continue;
        if (block.name === "Agent") {
          const input = block.input as { description?: string; subagent_type?: string; model?: string | null; prompt?: string };
          insertEvent.run(
            host,
            file.sessionId,
            file.agentId,
            ts,
            "agent_call",
            JSON.stringify({
              description: input.description ?? null,
              subagent_type: input.subagent_type ?? null,
              model: input.model ?? null,
              prompt_head: promptHead(String(input.prompt ?? "")),
            }),
          );
        } else if (block.name === "Skill") {
          insertEvent.run(host, file.sessionId, file.agentId, ts, "skill", JSON.stringify({ skill: (block.input as { skill?: string }).skill ?? null }));
        }
      }
      const usage = message?.usage;
      const requestId = record.requestId;
      const model = message?.model;
      if (!usage || !requestId || !model || model === "<synthetic>" || seenRequests.has(requestId)) continue;
      seenRequests.add(requestId);
      const input = usage.input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      let cache5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
      const cache1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      if (!usage.cache_creation) cache5m = usage.cache_creation_input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const thinking = usage.output_tokens_details?.thinking_tokens ?? 0;
      const cost = costUsd(model, { input, cache5m, cache1h, cacheRead, output });
      const result = insertRequest.run({
        $host: host,
        $session_id: file.sessionId,
        $agent_id: file.agentId,
        $request_id: requestId,
        $ts_ms: ts,
        $model: model,
        $input: input,
        $cache_5m: cache5m,
        $cache_1h: cache1h,
        $cache_read: cacheRead,
        $output: output,
        $thinking: thinking,
        $context: input + cache5m + cache1h + cacheRead,
        $cost_usd: cost ?? null,
      });
      added += result.changes;
    }
    if (file.agentId === "") {
      upsertSession.run({
        $id: file.sessionId,
        $host: host,
        $project: file.project,
        $cwd: cwd ?? null,
        $git_branch: gitBranch ?? null,
        $version: version ?? null,
        $title: title ?? null,
        $first_prompt: firstPrompt === undefined ? null : promptHead(firstPrompt),
        $started_ms: startedMs ?? null,
        $ended_ms: endedMs ?? null,
      });
    } else {
      upsertAgent.run({
        $id: file.agentId,
        $session_id: file.sessionId,
        $host: host,
        $prompt_head: firstPrompt === undefined ? null : promptHead(firstPrompt),
        $started_ms: startedMs ?? null,
        $ended_ms: endedMs ?? null,
      });
      // A subagent's parent session may have no transcript of its own yet.
      upsertSession.run({
        $id: file.sessionId,
        $host: host,
        $project: file.project,
        $cwd: null,
        $git_branch: null,
        $version: null,
        $title: null,
        $first_prompt: null,
        $started_ms: null,
        $ended_ms: null,
      });
    }
    upsertFile.run(file.path, host, file.project, file.sessionId, file.agentId || null, size, mtimeMs, end);
    return added;
  });

  for (const file of files) {
    stats.filesScanned += 1;
    let size: number;
    let mtimeMs: number;
    try {
      const stat = statSync(file.path);
      size = stat.size;
      mtimeMs = Math.round(stat.mtimeMs);
    } catch {
      continue;
    }
    const previous = known.get(file.path);
    let offset = previous?.offset ?? 0;
    if (previous && previous.size === size && previous.mtime_ms === mtimeMs) continue;
    if (previous && size < previous.offset) {
      for (const statement of deleteFileRows) statement.run(host, file.sessionId, file.agentId);
      offset = 0;
    }
    stats.filesChanged += 1;
    try {
      stats.requestsAdded += ingestFile(file, size, mtimeMs, offset);
    } catch (error) {
      // One unreadable transcript must not take the rest down. Remember its
      // size so it is retried only once it changes, and say so once.
      const message = (error as Error).message;
      stats.failed.push({ path: file.path, error: message });
      console.error(`slopestyle-usage: skipped ${file.path}: ${message}`);
      upsertFile.run(file.path, host, file.project, file.sessionId, file.agentId || null, size, mtimeMs, offset);
    }
  }

  linkAgentCalls(db, host);
  return stats;
}

// Fill each subagent's type, model, and description from the parent's Agent
// call whose prompt head matches the subagent's first user message.
function linkAgentCalls(db: Database, host: string): void {
  const pending = db
    .query<{ id: string; session_id: string; prompt_head: string }, [string]>(
      "SELECT id, session_id, prompt_head FROM agents WHERE host = ? AND subagent_type IS NULL AND prompt_head IS NOT NULL",
    )
    .all(host);
  if (pending.length === 0) return;
  const calls = db.query<{ data: string }, [string, string]>("SELECT data FROM events WHERE host = ? AND session_id = ? AND kind = 'agent_call'");
  const update = db.query("UPDATE agents SET subagent_type = ?, model_requested = ?, description = ? WHERE id = ?");
  for (const agent of pending) {
    for (const row of calls.all(host, agent.session_id)) {
      const call = JSON.parse(row.data) as { description: string | null; subagent_type: string | null; model: string | null; prompt_head: string };
      if (call.prompt_head !== agent.prompt_head) continue;
      update.run(call.subagent_type ?? "unknown", call.model, call.description, agent.id);
      break;
    }
  }
}

export function unpricedModels(db: Database): string[] {
  return db
    .query<{ model: string }, []>("SELECT DISTINCT model FROM requests WHERE cost_usd IS NULL")
    .all()
    .map((row) => row.model)
    .filter((model) => priceFor(model) === undefined);
}
