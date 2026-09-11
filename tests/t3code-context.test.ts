import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const script = resolve(
    import.meta.dir,
    "../skills/t3code-context/scripts/threads.py",
  ),
  dirs: string[] = [];
function fixture(optional = true) {
  const dir = mkdtempSync(join(tmpdir(), "t3-reader-"));
  dirs.push(dir);
  const path = join(dir, "state.sqlite"),
    db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE projection_projects(project_id TEXT PRIMARY KEY,title TEXT,workspace_root TEXT,scripts_json TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY,project_id TEXT,title TEXT,model TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT,archived_at TEXT);
CREATE TABLE projection_thread_sessions(thread_id TEXT PRIMARY KEY,status TEXT,provider_name TEXT,updated_at TEXT);
CREATE TABLE provider_session_runtime(thread_id TEXT PRIMARY KEY,provider_name TEXT,provider_instance_id TEXT,adapter_key TEXT,status TEXT,last_seen_at TEXT,resume_cursor_json TEXT,runtime_payload_json TEXT);
CREATE TABLE projection_thread_messages(message_id TEXT PRIMARY KEY,thread_id TEXT,turn_id TEXT,role TEXT,text TEXT,is_streaming INTEGER,created_at TEXT,updated_at TEXT,attachments_json TEXT);
CREATE TABLE projection_thread_activities(activity_id TEXT PRIMARY KEY,thread_id TEXT,turn_id TEXT,tone TEXT,kind TEXT,summary TEXT,payload_json TEXT,created_at TEXT,sequence INTEGER);
CREATE TABLE projection_thread_proposed_plans(plan_id TEXT PRIMARY KEY,thread_id TEXT,turn_id TEXT,plan_markdown TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE orchestration_events(sequence INTEGER PRIMARY KEY,event_id TEXT,aggregate_kind TEXT,stream_id TEXT,event_type TEXT,payload_json TEXT,metadata_json TEXT);
`);
  if (optional)
    db.exec(
      `CREATE TABLE projection_turns(row_id INTEGER PRIMARY KEY,thread_id TEXT,turn_id TEXT,requested_at TEXT,checkpoint_files_json TEXT);CREATE TABLE projection_thread_pull_requests(thread_id TEXT,host TEXT,repository TEXT,number INTEGER,linked_at TEXT,snapshot_json TEXT,stack_json TEXT);CREATE TABLE checkpoint_diff_blobs(thread_id TEXT,from_turn_count INTEGER,to_turn_count INTEGER,diff TEXT);CREATE TABLE projection_pending_approvals(request_id TEXT,thread_id TEXT,created_at TEXT,status TEXT);`,
    );
  db.query("INSERT INTO projection_projects VALUES(?,?,?,?,?,?,?)").run(
    "p1",
    "Project",
    "/work/p",
    "{}",
    "1",
    "2",
    null,
  );
  const t = db.query("INSERT INTO projection_threads VALUES(?,?,?,?,?,?,?,?)");
  t.run("active", "p1", "100%_ literal", "model", "1", "3", null, null);
  t.run("archived", "p1", "Old", "model", "1", "2", null, "2");
  t.run("deleted", "p1", "Gone", "model", "1", "1", "1", null);
  db.query("INSERT INTO projection_thread_sessions VALUES(?,?,?,?)").run(
    "active",
    "idle",
    "codex",
    "3",
  );
  db.query("INSERT INTO provider_session_runtime VALUES(?,?,?,?,?,?,?,?)").run(
    "active",
    "codex",
    "i1",
    "codex",
    "idle",
    "3",
    '{"resume":"opaque"}',
    '{"secret":"hidden"}',
  );
  const m = db.query(
    "INSERT INTO projection_thread_messages VALUES(?,?,?,?,?,?,?,?,?)",
  );
  m.run("m2", "active", null, "assistant", "second", 0, "2", "2", null);
  m.run(
    "m1",
    "active",
    null,
    "user",
    "first literal",
    0,
    "1",
    "1",
    '[{"name":"a.png"}]',
  );
  m.run("m0", "active", null, "assistant", "same", 1, "1", "1", null);
  const a = db.query(
    "INSERT INTO projection_thread_activities VALUES(?,?,?,?,?,?,?,?,?)",
  );
  a.run("a0", "active", null, "info", "note", "zero", '{"full":0}', "1", null);
  a.run("a2", "active", null, "info", "tool", "two", '{"full":2}', "2", 2);
  a.run("a1", "active", null, "info", "tool", "one", '{"full":1}', "2", 1);
  db.query(
    "INSERT INTO projection_thread_proposed_plans VALUES(?,?,?,?,?,?)",
  ).run("plan", "active", null, "Do it", "2", "2");
  db.query("INSERT INTO orchestration_events VALUES(?,?,?,?,?,?,?)").run(
    1,
    "e1",
    "thread",
    "active",
    "Removed",
    '{"text":"reverted"}',
    "{}",
  );
  if (optional) {
    db.query("INSERT INTO projection_turns VALUES(?,?,?,?,?)").run(
      1,
      "active",
      "turn",
      "1",
      '["x.ts"]',
    );
    db.query(
      "INSERT INTO projection_thread_pull_requests VALUES(?,?,?,?,?,?,?)",
    ).run("active", "github.com", "x/y", 4, "2", '{"title":"PR"}', "[]");
    db.query("INSERT INTO checkpoint_diff_blobs VALUES(?,?,?,?)").run(
      "active",
      0,
      1,
      "diff",
    );
    db.query("INSERT INTO projection_pending_approvals VALUES(?,?,?,?)").run(
      "req",
      "active",
      "2",
      "pending",
    );
  }
  return { dir, path, db };
}
function cli(path: string, ...args: string[]) {
  const r = Bun.spawnSync(["python3", script, "--db", path, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    stdout = r.stdout.toString();
  return {
    code: r.exitCode,
    stdout,
    stderr: r.stderr.toString(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe("t3code-context SQLite reader", () => {
  test("should order sections deterministically and page explicitly", () => {
    const f = fixture();
    const page = cli(f.path, "read", "active", "messages", "--limit", "2").json;
    expect(typeof page.captured_at).toBe("string");
    expect(page.source).toEqual({
      kind: "t3-sqlite-projections",
      database: realpathSync(f.path),
      read_only: true,
    });
    expect(page.total).toBe(3);
    expect(page.next_offset).toBe(2);
    expect(page.items.map((x: any) => x.message_id)).toEqual(["m0", "m1"]);
    expect(
      cli(f.path, "read", "active", "activities").json.items.map(
        (x: any) => x.activity_id,
      ),
    ).toEqual(["a0", "a1", "a2"]);
    f.db.close();
  });
  test("should search literally and resolve exact archived or deleted ids", () => {
    const f = fixture();
    expect(
      cli(f.path, "list", "--search", "100%_", "--project", "/work/p").json
        .total,
    ).toBe(1);
    expect(cli(f.path, "list", "--all").json.total).toBe(3);
    expect(cli(f.path, "inspect", "archived").json.thread_state).toBe(
      "archived",
    );
    expect(cli(f.path, "inspect", "deleted").json.thread_state).toBe("deleted");
    const missing = cli(f.path, "inspect", "active' OR 1=1 --");
    expect(missing.stderr).toContain("thread not found");
    expect(missing.stderr).toContain(`database: ${realpathSync(f.path)}`);
    f.db.close();
  });
  test("should separate current projections from historical events", () => {
    const f = fixture();
    expect(cli(f.path, "read", "active", "messages").stdout).not.toContain(
      "reverted",
    );
    const events = cli(f.path, "read", "active", "events").json;
    expect(events.historical).toBe(true);
    expect(events.items[0].payload.text).toBe("reverted");
    f.db.close();
  });
  test("should report unavailable optional sections and reject malformed JSON", () => {
    const f = fixture(false),
      inspection = cli(f.path, "inspect", "active").json;
    expect(inspection.sections.turns.available).toBe(false);
    expect(cli(f.path, "read", "active", "turns").stderr).toContain(
      "unavailable",
    );
    f.db
      .query(
        "UPDATE projection_thread_messages SET attachments_json=? WHERE message_id='m1'",
      )
      .run("{bad");
    expect(cli(f.path, "read", "active", "messages").stderr).toContain(
      "malformed stored JSON",
    );
    f.db.close();
  });
  test("should read committed WAL data while writer lives and never expose runtime payload", () => {
    const f = fixture();
    f.db
      .query("INSERT INTO projection_thread_messages VALUES(?,?,?,?,?,?,?,?,?)")
      .run("wal", "active", null, "user", "WAL visible", 0, "3", "3", null);
    const before = statSync(f.path).mtimeMs,
      result = cli(f.path, "inspect", "active");
    expect(cli(f.path, "read", "active", "messages").stdout).toContain(
      "WAL visible",
    );
    expect(statSync(f.path).mtimeMs).toBe(before);
    expect(result.json.provider_runtime.resume_cursor).toEqual({
      resume: "opaque",
    });
    expect(result.stdout).not.toContain("hidden");
    expect(result.stdout).not.toContain("runtime_payload");
    f.db.close();
  });
  test("should inventory only the requested thread resources and mark missing paths", () => {
    const f = fixture(),
      provider = join(f.dir, "logs", "provider");
    mkdirSync(provider, { recursive: true });
    writeFileSync(join(provider, "events.active.log"), "one");
    writeFileSync(join(provider, "events.active.log.2"), "two");
    writeFileSync(join(provider, "events.other.log"), "other");
    writeFileSync(join(provider, "events.active.log.bad"), "bad");
    const resources = cli(f.path, "inspect", "active").json.resources;
    expect(
      resources
        .filter((x: any) => x.kind === "provider-log")
        .map((x: any) => x.path)
        .sort(),
    ).toEqual([
      realpathSync(join(provider, "events.active.log")),
      realpathSync(join(provider, "events.active.log.2")),
    ]);
    expect(
      resources
        .filter((x: any) => x.kind !== "provider-log")
        .every((x: any) => x.available === false),
    ).toBe(true);
    f.db.close();
  });
  test("should export current data exclusively with mode 0600 and omissions", () => {
    const f = fixture(),
      out = join(f.dir, "export.json");
    expect(
      cli(f.path, "export", "active", "--output", out, "--format", "json").code,
    ).toBe(0);
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data.projections.messages[1].attachments[0].name).toBe("a.png");
    expect(data.projections["pull-requests"][0].snapshot.title).toBe("PR");
    expect(data.projections.events).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("hidden");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(cli(f.path, "export", "active", "--output", out).stderr).toContain(
      "already exists",
    );
    expect(
      cli(f.path, "export", "active", "--output", f.path).stderr,
    ).toContain("database or a sidecar");
    f.db.close();
  });
  test("should render complete multiline messages and plans in Markdown", () => {
    const f = fixture(),
      out = join(f.dir, "export.md"),
      message = "first line\n\nsecond `line`";
    f.db
      .query(
        "UPDATE projection_thread_messages SET text=? WHERE message_id='m1'",
      )
      .run(message);
    f.db
      .query(
        "UPDATE projection_thread_proposed_plans SET plan_markdown=? WHERE plan_id='plan'",
      )
      .run("# Plan\n\n- Keep this readable");
    expect(cli(f.path, "export", "active", "--output", out).code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain(`### user · m1 · 1\n\n${message}\n\nAttachments:`);
    expect(text).toContain("### plan\n\n# Plan\n\n- Keep this readable");
    expect(text).toContain("Full activity payloads are omitted");
    expect(text).not.toContain('"text": "first line\\n');
    expect(text).not.toContain('"payload"');
    f.db.close();
  });
  test("should never create a missing input database", () => {
    const f = fixture(),
      missing = join(f.dir, "missing.sqlite");
    f.db.close();
    expect(cli(missing, "list").stderr).toContain("database does not exist");
    expect(existsSync(missing)).toBe(false);
  });
});
