#!/usr/bin/env bun
// Read and export T3 Code thread context from its local SQLite projections.
import { Database, SQLiteError } from "bun:sqlite";
import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { basename, dirname, join, resolve } from "node:path";

type Row = Record<string, unknown>;
const SECTIONS = [
  "messages",
  "activities",
  "plans",
  "turns",
  "pull-requests",
  "subagents",
  "events",
  "checkpoints",
  "approvals",
] as const;
type SectionName = (typeof SECTIONS)[number];
// A section maps to its table, required columns, order, and row filter, or to
// the reason it is unavailable in that schema.
type TableSpec = {
  table: string;
  required: string[];
  order: string;
  where: string;
};
type Spec = TableSpec | string;

const BY_THREAD = "thread_id=?";
const spec = (
  table: string,
  required: string[],
  order: string,
  where = BY_THREAD,
): Spec => ({ table, required, order, where });
const LEGACY_SECTIONS: Record<SectionName, Spec> = {
  messages: spec(
    "projection_thread_messages",
    [
      "thread_id",
      "message_id",
      "role",
      "text",
      "is_streaming",
      "created_at",
      "attachments_json",
    ],
    "created_at,message_id",
  ),
  activities: spec(
    "projection_thread_activities",
    ["thread_id", "activity_id", "sequence", "created_at", "payload_json"],
    "sequence IS NOT NULL,sequence,created_at,activity_id",
  ),
  plans: spec(
    "projection_thread_proposed_plans",
    ["thread_id", "plan_id", "plan_markdown", "created_at"],
    "created_at,plan_id",
  ),
  turns: spec(
    "projection_turns",
    ["thread_id", "row_id", "turn_id", "requested_at", "checkpoint_files_json"],
    "requested_at,COALESCE(turn_id,''),row_id",
  ),
  "pull-requests": spec(
    "projection_thread_pull_requests",
    [
      "thread_id",
      "linked_at",
      "host",
      "repository",
      "number",
      "snapshot_json",
      "stack_json",
    ],
    "linked_at,host,repository,number",
  ),
  subagents: "subagents are recorded only in the orchestration-v2 schema",
  events: spec(
    "orchestration_events",
    [
      "aggregate_kind",
      "stream_id",
      "sequence",
      "payload_json",
      "metadata_json",
    ],
    "sequence",
    "aggregate_kind='thread' AND stream_id=?",
  ),
  checkpoints: spec(
    "checkpoint_diff_blobs",
    ["thread_id", "from_turn_count", "to_turn_count"],
    "from_turn_count,to_turn_count",
  ),
  approvals: spec(
    "projection_pending_approvals",
    ["thread_id", "request_id", "created_at"],
    "created_at,request_id",
  ),
};
const V2_SECTIONS: Record<SectionName, Spec> = {
  messages: spec(
    "orchestration_v2_projection_messages",
    [
      "thread_id",
      "message_id",
      "role",
      "streaming",
      "created_at",
      "payload_json",
    ],
    "created_at,message_id",
  ),
  activities: spec(
    "orchestration_v2_projection_turn_items",
    ["thread_id", "turn_item_id", "ordinal", "type", "payload_json"],
    "ordinal,turn_item_id",
  ),
  plans: spec(
    "orchestration_v2_projection_plans",
    ["thread_id", "plan_id", "payload_json"],
    "plan_id",
  ),
  turns: spec(
    "orchestration_v2_projection_runs",
    ["thread_id", "run_id", "ordinal", "requested_at", "payload_json"],
    "ordinal,run_id",
  ),
  "pull-requests":
    "orchestration-v2 stores linked pull requests on the thread record; read thread.payload from inspect",
  subagents: spec(
    "orchestration_v2_projection_subagents",
    [
      "thread_id",
      "subagent_id",
      "child_thread_id",
      "started_at",
      "payload_json",
    ],
    "COALESCE(started_at,''),subagent_id",
  ),
  events: spec(
    "orchestration_v2_events",
    ["thread_id", "sequence", "event_type", "payload_json"],
    "sequence",
  ),
  checkpoints:
    "orchestration-v2 records checkpoints as activities of type checkpoint",
  approvals: spec(
    "orchestration_v2_projection_runtime_requests",
    ["thread_id", "runtime_request_id", "created_at", "payload_json"],
    "created_at,runtime_request_id",
  ),
};
const V2_THREADS = "orchestration_v2_projection_threads";
const V2_PROVIDER_SESSIONS = "orchestration_v2_projection_provider_sessions";
const V2_PROVIDER_THREADS = "orchestration_v2_projection_provider_threads";
const ALLOW = new Set([
  ...[...Object.values(LEGACY_SECTIONS), ...Object.values(V2_SECTIONS)].flatMap(
    (v) => (typeof v === "string" ? [] : [v.table]),
  ),
  "projection_threads",
  "projection_projects",
  "projection_thread_sessions",
  "provider_session_runtime",
  V2_THREADS,
  V2_PROVIDER_SESSIONS,
  V2_PROVIDER_THREADS,
]);
const V2_MESSAGE_FIELDS = new Set([
  "id",
  "threadId",
  "runId",
  "nodeId",
  "role",
  "text",
  "attachments",
  "streaming",
  "createdAt",
  "updatedAt",
]);
const THREAD_COLUMNS = [
  "thread_id",
  "project_id",
  "title",
  "created_at",
  "updated_at",
  "deleted_at",
];
const PROJECT_COLUMNS = ["project_id", "title", "workspace_root"];

class ReaderError extends Error {}
class UsageError extends Error {}

const json = (value: unknown) => JSON.stringify(value, null, 2);
// UTC timestamp with microseconds and an explicit +00:00 offset.
const now = () => new Date().toISOString().replace("Z", "000+00:00");
const expandUser = (path: string) =>
  path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
// pathlib's resolve(strict=False): resolve symlinks in the existing prefix.
function resolvePath(path: string): string {
  const absolute = resolve(expandUser(path));
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  const parent = dirname(absolute);
  return parent === absolute
    ? absolute
    : join(resolvePath(parent), basename(absolute));
}

function v2Message(row: Row): Row {
  const {
    payload,
    message_id,
    thread_id,
    role,
    streaming,
    created_at,
    ...rest
  } = row;
  const body = (payload ?? {}) as Row;
  const result: Row = {
    message_id,
    thread_id,
    role,
    text: body.text ?? "",
    is_streaming: streaming,
    created_at,
    attachments: body.attachments ?? null,
    ...rest,
  };
  const extra = Object.fromEntries(
    Object.entries(body).filter(([k]) => !V2_MESSAGE_FIELDS.has(k)),
  );
  if (Object.keys(extra).length) result.payload = extra;
  return result;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function decode(row: Row, table: string): Row;
function decode(row: Row | null, table: string): Row | null;
function decode(row: Row | null, table: string): Row | null {
  if (!row) {
    return null;
  }
  const result = { ...row };
  for (const key of Object.keys(result)) {
    if (!key.endsWith("_json")) {
      continue;
    }
    const raw = result[key];
    delete result[key];
    try {
      result[key.slice(0, -5)] = raw === null ? null : JSON.parse(String(raw));
    } catch (error) {
      throw new ReaderError(
        `malformed stored JSON in ${table}.${key}: ${errorMessage(error)}`,
      );
    }
  }
  return result;
}

const nextOffset = (offset: number, count: number, total: number) =>
  offset + count < total ? offset + count : null;

class Reader {
  readonly path: string;
  readonly db: Database;
  readonly v2: boolean;
  readonly sections: Record<SectionName, Spec>;
  readonly threadsTable: string;

  constructor(path: string) {
    this.path = resolvePath(path);
    if (!existsSync(this.path) || !statSync(this.path).isFile()) {
      throw new ReaderError(`database does not exist: ${this.path}`);
    }
    try {
      this.db = new Database(this.path, { readonly: true });
      this.db.exec("PRAGMA query_only=ON");
      this.db.exec("BEGIN");
    } catch (error) {
      throw new ReaderError(
        `cannot open database read-only: ${errorMessage(error)}`,
      );
    }
    // statev2.sqlite also keeps the legacy tables, frozen at migration time.
    this.v2 = this.columns(V2_THREADS) !== null;
    this.sections = this.v2 ? V2_SECTIONS : LEGACY_SECTIONS;
    this.threadsTable = this.v2 ? V2_THREADS : "projection_threads";
  }

  close() {
    this.db.exec("ROLLBACK");
    this.db.close();
  }

  rows(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.db.query(sql).all(...params) as Row[];
  }

  one(sql: string, ...params: (string | number | null)[]): Row | null {
    return (this.db.query(sql).get(...params) as Row | null) ?? null;
  }

  count(sql: string, ...params: (string | number | null)[]): number {
    return this.db.query(sql).values(...params)[0]![0] as number;
  }

  columns(table: string): Set<string> | null {
    if (!ALLOW.has(table)) {
      throw new ReaderError("internal table allowlist violation");
    }
    const names = this.rows(
      `SELECT name FROM pragma_table_info("${table}")`,
    ).map((r) => r.name as string);
    return names.length ? new Set(names) : null;
  }

  // The section's table spec, or the reason it is unavailable here.
  availability(name: SectionName): [TableSpec, null] | [null, string] {
    const s = this.sections[name];
    if (typeof s === "string") {
      return [null, s];
    }
    const columns = this.columns(s.table);
    if (columns === null) {
      return [null, `table ${s.table} is unavailable`];
    }
    const missing = s.required.filter((c) => !columns.has(c)).sort();
    return missing.length
      ? [null, `table ${s.table} is missing columns: ${missing.join(", ")}`]
      : [s, null];
  }

  require(table: string, required: string[]) {
    const columns = this.columns(table);
    if (columns === null) {
      throw new ReaderError(`required table is unavailable: ${table}`);
    }
    const missing = required.filter((c) => !columns.has(c)).sort();
    if (missing.length) {
      throw new ReaderError(
        `${table} is missing required columns: ${missing.join(", ")}`,
      );
    }
  }

  spec(name: SectionName): TableSpec {
    const [spec, reason] = this.availability(name);
    if (!spec) {
      throw new ReaderError(`section ${name} is unavailable: ${reason}`);
    }
    return spec;
  }

  sectionCount(threadId: string, name: SectionName): number {
    const { table, where } = this.spec(name);
    return this.count(
      `SELECT COUNT(*) FROM ${table} WHERE ${where}`,
      threadId,
    );
  }

  thread(threadId: string): [Row, Row | null] {
    this.require(this.threadsTable, THREAD_COLUMNS);
    this.require("projection_projects", PROJECT_COLUMNS);
    const thread = decode(
      this.one(
        `SELECT * FROM ${this.threadsTable} WHERE thread_id=?`,
        threadId,
      ),
      this.threadsTable,
    );
    if (!thread) {
      throw new ReaderError(`thread not found: ${threadId}`);
    }
    const project = decode(
      this.one(
        "SELECT * FROM projection_projects WHERE project_id=?",
        thread.project_id as string,
      ),
      "projection_projects",
    );
    return [thread, project];
  }

  page(threadId: string, name: SectionName, limit = 50, offset = 0) {
    this.thread(threadId);
    const { table, order, where } = this.spec(name);
    const total = this.sectionCount(threadId, name);
    const items = this.rows(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      threadId,
      limit,
      offset,
    ).map((r) => this.item(name, table, r));
    return {
      captured_at: now(),
      source: this.source(),
      section: name,
      historical: name === "events",
      total,
      offset,
      limit,
      next_offset: nextOffset(offset, items.length, total),
      items,
    };
  }

  all(threadId: string, name: SectionName): Row[] {
    const { table, order, where } = this.spec(name);
    return this.rows(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`,
      threadId,
    ).map((r) => this.item(name, table, r));
  }

  item(name: SectionName, table: string, row: Row): Row {
    const item = decode(row, table);
    return this.v2 && name === "messages" ? v2Message(item) : item;
  }

  threadRows(table: string, order: string, threadId: string): Row[] | null {
    const columns = this.columns(table);
    if (!columns?.has("thread_id")) {
      return null;
    }
    return this.rows(
      `SELECT * FROM ${table} WHERE thread_id=? ORDER BY ${order}`,
      threadId,
    ).map((r) => decode(r, table));
  }

  source() {
    return {
      kind: "t3-sqlite-projections",
      schema: this.v2 ? "orchestration-v2" : "legacy",
      database: this.path,
      read_only: true,
    };
  }

  resources(threadId: string) {
    const state = dirname(this.path);
    const candidates: [string, string][] = [
      ["attachments-directory", join(state, "attachments")],
      ["environment-id", join(state, "environment-id")],
    ];
    const provider = join(state, "logs", "provider");
    const base = `events.${threadId}.log`;
    // The thread's provider log and its numbered rotations.
    const isThreadLog = (name: string) =>
      name === base ||
      (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1)));
    try {
      if (statSync(provider).isDirectory()) {
        for (const name of readdirSync(provider)) {
          if (isThreadLog(name)) {
            candidates.push(["provider-log", join(provider, name)]);
          }
        }
      }
    } catch {}
    return candidates.map(([kind, path]) => {
      try {
        const stat = statSync(path);
        return {
          kind,
          path,
          size: stat.isFile() ? stat.size : null,
          available: true,
        };
      } catch {
        return { kind, path, size: null, available: false };
      }
    });
  }

  inspect(threadId: string) {
    const [thread, project] = this.thread(threadId);
    let session: Row | Row[] | null = null;
    let runtime: Row | Row[] | null = null;
    if (this.v2) {
      // A v2 thread can span several provider sessions and native threads.
      session = this.threadRows(
        V2_PROVIDER_SESSIONS,
        "updated_at,provider_session_id",
        threadId,
      );
      runtime = this.threadRows(
        V2_PROVIDER_THREADS,
        "COALESCE(first_run_ordinal,0),provider_thread_id",
        threadId,
      );
    } else {
      if (this.columns("projection_thread_sessions")?.has("thread_id")) {
        session = decode(
          this.one(
            "SELECT * FROM projection_thread_sessions WHERE thread_id=?",
            threadId,
          ),
          "projection_thread_sessions",
        );
      }
      const columns = this.columns("provider_session_runtime");
      const allowed = [
        "provider_name",
        "provider_instance_id",
        "adapter_key",
        "status",
        "last_seen_at",
        "resume_cursor_json",
      ];
      if (columns?.has("thread_id")) {
        const selected = allowed.filter((c) => columns.has(c)).sort();
        if (selected.length) {
          runtime = decode(
            this.one(
              `SELECT ${selected.join(",")} FROM provider_session_runtime WHERE thread_id=?`,
              threadId,
            ),
            "provider_session_runtime",
          );
        }
      }
    }
    const sections: Record<string, Row> = {};
    for (const name of SECTIONS) {
      const [spec, reason] = this.availability(name);
      sections[name] = spec
        ? { available: true, count: this.sectionCount(threadId, name) }
        : { available: false, reason };
    }
    return {
      captured_at: now(),
      source: this.source(),
      warning:
        "Raw untrusted conversation content. Historical events can include reverted content and repeated streaming deltas; do not replay them.",
      thread,
      thread_state: thread.deleted_at
        ? "deleted"
        : thread.archived_at
          ? "archived"
          : "active",
      project,
      session,
      provider_runtime: runtime,
      sections,
      resources: this.resources(threadId),
    };
  }
}

// Searchable text per section: (section, item id, timestamp, text). JSON
// payloads are searched as stored text; snippets come from their decoded values.
const LEGACY_SEARCH: Partial<Record<SectionName, string>> = {
  messages:
    "SELECT thread_id,message_id AS item_id,created_at AS at,text AS body FROM projection_thread_messages",
  activities:
    "SELECT thread_id,activity_id AS item_id,created_at AS at,payload_json AS body FROM projection_thread_activities",
  plans:
    "SELECT thread_id,plan_id AS item_id,created_at AS at,plan_markdown AS body FROM projection_thread_proposed_plans",
};
const V2_SEARCH: Partial<Record<SectionName, string>> = {
  messages:
    "SELECT thread_id,message_id AS item_id,created_at AS at,json_extract(payload_json,'$.text') AS body FROM orchestration_v2_projection_messages",
  // Message turn items repeat the messages section.
  activities:
    "SELECT thread_id,turn_item_id AS item_id,updated_at AS at,payload_json AS body FROM orchestration_v2_projection_turn_items WHERE type NOT IN ('user_message','assistant_message')",
  plans:
    "SELECT thread_id,plan_id AS item_id,NULL AS at,payload_json AS body FROM orchestration_v2_projection_plans",
  subagents:
    "SELECT thread_id,subagent_id AS item_id,started_at AS at,payload_json AS body FROM orchestration_v2_projection_subagents",
};

// Text around the first case-insensitive match, preferring a decoded JSON
// string. Widths count code points so astral characters are never split.
function snippet(text: string, term: string, width = 80): string {
  const needle = term.toLowerCase();
  try {
    const stack: unknown[] = [JSON.parse(text)];
    while (stack.length) {
      const value = stack.pop();
      if (typeof value === "string" && value.toLowerCase().includes(needle)) {
        text = value;
        break;
      }
      if (Array.isArray(value)) {
        stack.push(...value.toReversed());
      } else if (value && typeof value === "object") {
        stack.push(...Object.values(value).toReversed());
      }
    }
  } catch {}
  const chars = Array.from(text);
  const found = text.toLowerCase().indexOf(needle);
  const at = found < 0 ? 0 : Array.from(text.slice(0, found)).length;
  const start = Math.max(at - width, 0);
  const end = at + Array.from(term).length + width;
  return (
    (start ? "…" : "") +
    chars.slice(start, end).join("") +
    (end < chars.length ? "…" : "")
  );
}

interface ListArgs {
  search: string | null;
  project: string | null;
  all: boolean;
  since: string | null;
  until: string | null;
  messagesOnly: boolean;
  matches: number;
  limit: number;
  offset: number;
}

// The term, a query of every searchable hit, and which sections it covers.
interface SearchPlan {
  term: string;
  hits: string;
  searched: SectionName[];
  unavailable: Record<string, string>;
}

function planSearch(r: Reader, term: string, messagesOnly: boolean): SearchPlan {
  const [messages, reason] = r.availability("messages");
  if (!messages) {
    throw new ReaderError(`search is unavailable: ${reason}`);
  }
  const sources = r.v2 ? V2_SEARCH : LEGACY_SEARCH;
  const names = messagesOnly
    ? (["messages"] as const)
    : SECTIONS.filter((name) => sources[name] !== undefined);
  const searched: SectionName[] = [];
  const unavailable: Record<string, string> = {};
  for (const name of names) {
    const [spec, why] = r.availability(name);
    if (spec) {
      searched.push(name);
    } else {
      unavailable[name] = why;
    }
  }
  const union = searched
    .map((name) => `SELECT '${name}' AS section,* FROM (${sources[name]})`)
    .join(" UNION ALL ");
  return {
    term,
    hits: `SELECT * FROM (${union}) WHERE instr(lower(body),lower(?))>0`,
    searched,
    unavailable,
  };
}

function listThreads(r: Reader, a: ListArgs) {
  r.require(r.threadsTable, THREAD_COLUMNS);
  r.require("projection_projects", PROJECT_COLUMNS);
  const filters: string[] = [];
  const params: string[] = [];
  const cols = r.columns(r.threadsTable) ?? new Set();
  if (!a.all) {
    filters.push("t.deleted_at IS NULL");
    if (cols.has("archived_at")) {
      filters.push("t.archived_at IS NULL");
    }
  }
  const search =
    a.search === null ? null : planSearch(r, a.search, a.messagesOnly);
  if (search) {
    filters.push(
      `(instr(lower(t.title),lower(?))>0 OR t.thread_id IN (SELECT thread_id FROM (${search.hits})))`,
    );
    params.push(search.term, search.term);
  }
  if (a.project !== null) {
    filters.push("(p.project_id=? OR p.title=? OR p.workspace_root=?)");
    params.push(a.project, a.project, a.project);
  }
  if (a.since !== null) {
    filters.push("t.updated_at>=?");
    params.push(a.since);
  }
  if (a.until !== null) {
    filters.push("t.updated_at<?");
    params.push(a.until);
  }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const base = ` FROM ${r.threadsTable} t LEFT JOIN projection_projects p ON p.project_id=t.project_id${where}`;
  const total = r.count(`SELECT COUNT(*)${base}`, ...params);
  const items = r
    .rows(
      `SELECT t.*,p.title AS project_title,p.workspace_root${base} ORDER BY t.updated_at DESC,t.thread_id LIMIT ? OFFSET ?`,
      ...params,
      a.limit,
      a.offset,
    )
    .map((x) => decode(x, r.threadsTable));
  if (search) {
    for (const item of items) {
      const found = r.rows(
        `SELECT section,item_id,at,body FROM (${search.hits}) WHERE thread_id=? ORDER BY at IS NULL,at,item_id LIMIT ?`,
        search.term,
        item.thread_id as string,
        a.matches + 1,
      );
      item.matches = found.slice(0, a.matches).map((m) => ({
        section: m.section,
        item_id: m.item_id,
        at: m.at,
        snippet: snippet(String(m.body), search.term),
      }));
      item.more_matches = found.length > a.matches;
    }
  }
  const result: Row = {
    source: r.source(),
    total,
    offset: a.offset,
    limit: a.limit,
    next_offset: nextOffset(a.offset, items.length, total),
    items,
  };
  if (search) {
    result.search = {
      searched: ["title", ...search.searched],
      unavailable: search.unavailable,
    };
  }
  return result;
}

function exportData(r: Reader, threadId: string) {
  const data = r.inspect(threadId);
  return {
    ...data,
    projections: Object.fromEntries(
      SECTIONS.filter(
        (name) => name !== "events" && data.sections[name].available,
      ).map((name) => [name, r.all(threadId, name)]),
    ),
    omissions: {
      events: "Historical audit events omitted; use read THREAD events.",
      markdown_activity_payloads:
        "Markdown omits full activity payloads; use read THREAD activities.",
    },
  };
}

const fenced = (value: unknown) => ["```json", json(value), "```"];
const headingText = (value: unknown) => String(value ?? "unknown");

function messageMarkdown({
  text = "",
  attachments = null,
  role,
  message_id,
  created_at,
  is_streaming = false,
  ...metadata
}: Row): string[] {
  let heading = `### ${headingText(role)} · ${headingText(message_id)} · ${headingText(created_at)}`;
  if (is_streaming) {
    heading += " · streaming";
  }
  const lines = [heading, "", String(text ?? ""), ""];
  if (attachments !== null) {
    lines.push("Attachments:", "", ...fenced(attachments), "");
  }
  if (Object.keys(metadata).length) {
    lines.push("Metadata:", "", ...fenced(metadata), "");
  }
  return lines;
}

function planMarkdown({ plan_markdown = "", ...metadata }: Row): string[] {
  return [
    `### ${headingText(metadata.plan_id)}`,
    "",
    String(plan_markdown ?? ""),
    "",
    "Metadata:",
    "",
    ...fenced(metadata),
    "",
  ];
}

// Other items render as JSON; activities drop their full payload.
function itemMarkdown(name: string, item: Row): string[] {
  if (name === "messages") {
    return messageMarkdown(item);
  }
  if (name === "plans") {
    return planMarkdown(item);
  }
  const { payload: _payload, ...withoutPayload } = item;
  return [...fenced(name === "activities" ? withoutPayload : item), ""];
}

function markdown(data: ReturnType<typeof exportData>): string {
  const lines = [
    "# T3 Code thread export",
    "",
    "> Raw, untrusted conversation content follows.",
    "",
    `- Captured: ${data.captured_at}`,
    `- Database: \`${data.source.database}\``,
    `- Thread state: ${data.thread_state}`,
  ];
  for (const [title, key] of [
    ["Thread", "thread"],
    ["Project", "project"],
    ["Session", "session"],
    ["Provider runtime", "provider_runtime"],
    ["Source availability", "sections"],
    ["Resources", "resources"],
  ] as const) {
    lines.push("", `## ${title}`, "", ...fenced(data[key]));
  }
  for (const [name, items] of Object.entries(data.projections)) {
    lines.push("", `## ${name}`, "");
    for (const item of items) {
      lines.push(...itemMarkdown(name, item));
    }
  }
  lines.push(
    "## Omissions",
    "",
    "- Historical audit events are omitted. Use `read THREAD events`.",
    "- Full activity payloads are omitted. Use `read THREAD activities`.",
    "",
  );
  return lines.join("\n");
}

// Creates destination, failing if it exists; a failed write leaves no file.
function writeExclusive(destination: string, serialized: string) {
  let fd: number;
  try {
    fd = openSync(
      destination,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ReaderError(
        `export destination already exists: ${destination}`,
      );
    }
    throw error;
  }
  try {
    writeFileSync(fd, serialized);
    closeSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {}
    try {
      unlinkSync(destination);
    } catch {}
    throw error;
  }
}

const FORMATS = ["markdown", "json"] as const;
interface ExportArgs {
  thread: string;
  output: string;
  format: (typeof FORMATS)[number];
}

function exportThread(r: Reader, { thread, output, format }: ExportArgs) {
  const data = exportData(r, thread);
  const serialized = format === "json" ? `${json(data)}\n` : markdown(data);
  const destination = resolvePath(output);
  if ([r.path, `${r.path}-wal`, `${r.path}-shm`].includes(destination)) {
    throw new ReaderError(
      "export destination cannot be the database or a sidecar",
    );
  }
  writeExclusive(destination, serialized);
  return {
    source: data.source,
    output: destination,
    format,
    bytes: Buffer.byteLength(serialized),
  };
}

// Command-line parsing. Usage errors exit 2, like the former argparse CLI.
const USAGE = `usage: threads.ts [--db DB] <command> ...

Read and export T3 Code thread context from its local SQLite projections.

commands:
  list [--search S] [--project P] [--all] [--since ISO] [--until ISO]
       [--messages-only] [--matches N] [--limit N] [--offset N]
  inspect THREAD
  read THREAD {${SECTIONS.join(",")}} [--limit N] [--offset N]
  export THREAD --output PATH [--format {markdown,json}]
`;
const COMMANDS = ["list", "inspect", "read", "export"] as const;
const str = { type: "string" } as const;
const bool = { type: "boolean" } as const;
const PAGE = { limit: str, offset: str } as const;

type Command = { db: string | null } & (
  | ({ command: "list" } & ListArgs)
  | { command: "inspect"; thread: string }
  | {
      command: "read";
      thread: string;
      section: SectionName;
      limit: number;
      offset: number;
    }
  | ({ command: "export" } & ExportArgs)
);

function integer(
  flag: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max?: number,
) {
  if (raw === undefined) {
    return fallback;
  }
  const n = /^\s*[-+]?\d+\s*$/.test(raw)
    ? Number.parseInt(raw, 10)
    : Number.NaN;
  if (!(n >= min && n <= (max ?? Infinity))) {
    throw new UsageError(
      max === undefined
        ? `--${flag} must be an integer of at least ${min}`
        : `--${flag} must be an integer between ${min} and ${max}`,
    );
  }
  return n;
}

function page(values: { limit?: string; offset?: string }) {
  return {
    limit: integer("limit", values.limit, 50, 1, 1000),
    offset: integer("offset", values.offset, 0, 0),
  };
}

function oneOf<T extends string>(
  name: string,
  raw: string,
  choices: readonly T[],
): T {
  const choice = choices.find((c) => c === raw);
  if (choice === undefined) {
    throw new UsageError(
      `invalid ${name} '${raw}' (choose from ${choices.join(", ")})`,
    );
  }
  return choice;
}

function strictParse<const O extends ParseArgsOptionsConfig>(
  argv: string[],
  options: O,
) {
  try {
    return parseArgs({
      args: argv,
      options: { ...options, db: str },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
}

// Strictly parses one command's options and its exact positional arguments.
function parseCommand<const O extends ParseArgsOptionsConfig>(
  argv: string[],
  command: string,
  options: O,
  positionals: readonly string[],
) {
  const parsed = strictParse(argv, options);
  const [, ...rest] = parsed.positionals;
  if (rest.length !== positionals.length) {
    throw new UsageError(
      `${command} expects ${positionals.join(" ") || "no positional arguments"}`,
    );
  }
  return { values: parsed.values, rest };
}

function parseCli(argv: string[]): Command {
  const globals = parseArgs({
    args: argv,
    options: { db: str, help: { ...bool, short: "h" } },
    strict: false,
    allowPositionals: true,
  });
  if (globals.values.help) {
    help();
  }
  const name = globals.positionals[0];
  if (name === undefined) {
    throw new UsageError("a command is required");
  }
  const command = oneOf("command", name, COMMANDS);
  switch (command) {
    case "list": {
      const { values: v } = parseCommand(
        argv,
        command,
        {
          search: str,
          project: str,
          all: bool,
          since: str,
          until: str,
          "messages-only": bool,
          matches: str,
          ...PAGE,
        },
        [],
      );
      return {
        command,
        db: v.db ?? null,
        search: v.search ?? null,
        project: v.project ?? null,
        all: v.all ?? false,
        since: v.since ?? null,
        until: v.until ?? null,
        messagesOnly: v["messages-only"] ?? false,
        matches: integer("matches", v.matches, 3, 1, 1000),
        ...page(v),
      };
    }
    case "inspect": {
      const {
        values: v,
        rest: [thread],
      } = parseCommand(argv, command, {}, ["thread"]);
      return { command, db: v.db ?? null, thread };
    }
    case "read": {
      const {
        values: v,
        rest: [thread, section],
      } = parseCommand(argv, command, PAGE, ["thread", "section"]);
      return {
        command,
        db: v.db ?? null,
        thread,
        section: oneOf("section", section, SECTIONS),
        ...page(v),
      };
    }
    case "export": {
      const {
        values: v,
        rest: [thread],
      } = parseCommand(argv, command, { output: str, format: str }, [
        "thread",
      ]);
      if (v.output === undefined) {
        throw new UsageError("export requires --output");
      }
      return {
        command,
        db: v.db ?? null,
        thread,
        output: v.output,
        format: oneOf("format", v.format ?? "markdown", FORMATS),
      };
    }
  }
}

function help(): never {
  process.stdout.write(USAGE);
  process.exit(0);
}

function run(r: Reader, a: Command) {
  switch (a.command) {
    case "list":
      return listThreads(r, a);
    case "inspect":
      return r.inspect(a.thread);
    case "read":
      return r.page(a.thread, a.section, a.limit, a.offset);
    case "export":
      return exportThread(r, a);
  }
}

function main(argv: string[]): number {
  let a: Command;
  try {
    a = parseCli(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) {
      throw error;
    }
    process.stderr.write(`${USAGE}\nerror: ${error.message}\n`);
    return 2;
  }
  const path =
    a.db ??
    join(
      expandUser(process.env.T3CODE_HOME ?? "~/.t3"),
      "userdata",
      "statev2.sqlite",
    );
  let r: Reader | null = null;
  try {
    r = new Reader(path);
    console.log(json(run(r, a)));
    return 0;
  } catch (error) {
    if (
      !(error instanceof ReaderError) &&
      !(error instanceof SQLiteError) &&
      typeof (error as NodeJS.ErrnoException)?.code !== "string"
    ) {
      throw error;
    }
    console.error(
      `error: ${errorMessage(error)} (database: ${resolvePath(path)})`,
    );
    return 1;
  } finally {
    r?.close();
  }
}

if (import.meta.main) {
  process.exitCode = main(Bun.argv.slice(2));
}
