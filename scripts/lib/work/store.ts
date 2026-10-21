import {
  validateSlackThread,
  FollowLimitReached,
  SLACK_FOLLOW_LIMIT,
} from "./validation.ts";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { digest } from "./prompts.ts";
import type {
  PRSnooze,
  Change,
  Json,
  PromptSnapshot,
  RunType,
  Source,
  SourceHealth,
  WorkRecord,
  WorkRun,
} from "./types.ts";

type StoredRun = Omit<WorkRun, "prompt"> & { prompt: string; hash: string };

function canonical(value: Json): string {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Invalid JSON number");
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    throw new Error("Invalid JSON value");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (
      Array.from({ length: value.length }, (_, index) => index).some(
        (index) => !Object.hasOwn(value, index),
      )
    )
      throw new Error("Invalid sparse JSON array");
    return `[${value.map(canonical).join(",")}]`;
  }
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("Invalid JSON object");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
function bounded(value: string): void {
  if (!value || value.length > 4096) throw new Error("Invalid identifier");
}
export class WorkStore {
  private db: Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS pr_snoozes(key TEXT PRIMARY KEY, version INTEGER NOT NULL, until INTEGER, durationHours INTEGER);
      CREATE TABLE IF NOT EXISTS records(source TEXT, key TEXT, data TEXT NOT NULL, digest TEXT NOT NULL, observedAt TEXT NOT NULL, PRIMARY KEY(source,key));
      CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, observedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS health(source TEXT PRIMARY KEY, attemptedAt TEXT, succeededAt TEXT, gap TEXT);
      CREATE TABLE IF NOT EXISTS consumers(name TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS followed(channel TEXT, rootTs TEXT, PRIMARY KEY(channel,rootTs));
      CREATE TABLE IF NOT EXISTS deliveries(runId TEXT PRIMARY KEY, request TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, prompt TEXT NOT NULL, hash TEXT NOT NULL, throughSeq INTEGER NOT NULL, UNIQUE(date,type));`);
  }
  close(): void {
    this.db.close();
  }
  latestSeq(): number {
    return this.db
      .query<{ seq: number }, []>(
        "SELECT COALESCE(MAX(seq),0) seq FROM changes",
      )
      .get()!.seq;
  }
  records(source?: Source): WorkRecord[] {
    const rows = source
      ? this.db
          .query<WorkRecord & { data: string }, [string]>(
            "SELECT * FROM records WHERE source=? ORDER BY key",
          )
          .all(source)
      : this.db
          .query<WorkRecord & { data: string }, []>(
            "SELECT * FROM records ORDER BY source,key",
          )
          .all();
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  // Expiry is a read-time interpretation. Retain versions and restore tombstones.
  snoozes(): PRSnooze[] {
    return this.db.query<PRSnooze, []>("SELECT * FROM pr_snoozes ORDER BY key").all();
  }
  setSnooze(key: string, expected: number, durationHours: 1 | 24 | null, now = Date.now()): boolean {
    bounded(key);
    if (!Number.isSafeInteger(expected) || expected < 0 || ![null, 1, 24].includes(durationHours) || !Number.isSafeInteger(now)) throw new Error("Invalid snooze");
    return this.db.transaction(() => {
      if (!this.db.query("SELECT 1 FROM records WHERE source='github' AND key=?").get(key)) throw new Error("Invalid snooze");
      const previous = this.db.query<PRSnooze, [string]>("SELECT * FROM pr_snoozes WHERE key=?").get(key);
      if ((previous?.version ?? 0) !== expected) return false;
      this.db.query("INSERT INTO pr_snoozes VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,until=excluded.until,durationHours=excluded.durationHours")
        .run(key, expected + 1, durationHours === null ? null : now + durationHours * 3_600_000, durationHours);
      return true;
    }).immediate();
  }
  health(source: Source): SourceHealth {
    return (
      this.db
        .query<SourceHealth, [string]>("SELECT * FROM health WHERE source=?")
        .get(source) ?? {
        source,
        attemptedAt: null,
        succeededAt: null,
        gap: null,
      }
    );
  }
  attempt(source: Source, at: string): void {
    this.db
      .query(
        "INSERT INTO health(source,attemptedAt) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET attemptedAt=excluded.attemptedAt",
      )
      .run(source, at);
  }
  fail(source: Source, at: string, gap = "Collection failed"): void {
    bounded(gap);
    this.db
      .query(
        "INSERT INTO health(source,attemptedAt,gap) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET attemptedAt=excluded.attemptedAt,gap=excluded.gap",
      )
      .run(source, at, gap);
  }
  applySnapshot(
    source: Source,
    rows: { key: string; data: Json }[],
    at: string,
    complete: boolean,
    health?: { succeededAt?: string; gap?: string },
  ): void {
    if (
      rows.length > 10_000 ||
      new Set(rows.map((r) => r.key)).size !== rows.length
    )
      throw new Error("Invalid snapshot size or duplicate keys");
    const prepared = rows.map((r) => {
      bounded(r.key);
      const data = canonical(r.data);
      if (data.length > 1_000_000) throw new Error("Record too large");
      return { ...r, data, digest: digest(data) };
    });
    if (prepared.reduce((size, row) => size + row.data.length, 0) > 10_000_000)
      throw new Error("Snapshot too large");
    this.db
      .transaction(() => {
        const previous = new Map(this.records(source).map((r) => [r.key, r]));
        for (const row of prepared) {
          if (previous.get(row.key)?.digest !== row.digest)
            this.db
              .query(
                "INSERT INTO changes(source,key,kind,data,observedAt) VALUES(?,?,'upsert',?,?)",
              )
              .run(source, row.key, row.data, at);
          this.db
            .query(
              "INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(source,key) DO UPDATE SET data=excluded.data,digest=excluded.digest,observedAt=excluded.observedAt",
            )
            .run(source, row.key, row.data, row.digest, at);
          previous.delete(row.key);
        }
        if (source === "github" && complete)
          for (const row of previous.values()) {
            this.db
              .query("DELETE FROM records WHERE source=? AND key=?")
              .run(source, row.key);
            this.db
              .query(
                "INSERT INTO changes(source,key,kind,data,observedAt) VALUES(?,?,'remove',?,?)",
              )
              .run(source, row.key, JSON.stringify(row.data), at);
          }
        this.db
          .query(
            "INSERT INTO health VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET attemptedAt=excluded.attemptedAt,succeededAt=COALESCE(excluded.succeededAt,health.succeededAt),gap=excluded.gap",
          )
          .run(
            source,
            at,
            health?.succeededAt ?? (complete ? at : null),
            health?.gap ?? (complete ? null : "Incomplete snapshot"),
          );
      })
      .immediate();
  }
  changes(after: number, limit = 100): Change[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error("Invalid change window");
    return this.db
      .query<Omit<Change, "data"> & { data: string }, [number, number]>(
        "SELECT * FROM changes WHERE seq>? ORDER BY seq LIMIT ?",
      )
      .all(after, limit)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  cursor(name: string): number {
    bounded(name);
    return (
      this.db
        .query<{ seq: number }, [string]>(
          "SELECT seq FROM consumers WHERE name=?",
        )
        .get(name)?.seq ?? 0
    );
  }
  acknowledge(name: string, expected: number, through: number): boolean {
    bounded(name);
    return this.db
      .transaction(() => {
        if (
          ![expected, through].every(Number.isSafeInteger) ||
          expected < 0 ||
          through < expected ||
          through > this.latestSeq()
        )
          throw new Error("Invalid acknowledgement");
        if (this.cursor(name) !== expected) return false;
        this.db
          .query(
            "INSERT INTO consumers VALUES(?,?) ON CONFLICT(name) DO UPDATE SET seq=excluded.seq",
          )
          .run(name, through);
        return true;
      })
      .immediate();
  }
  follow(channel: string, rootTs: string): void {
    validateSlackThread(channel, rootTs);
    this.db
      .transaction(() => {
        const followed = this.followed();
        if (
          followed.some(
            (row) => row.channel === channel && row.rootTs === rootTs,
          )
        )
          return;
        if (followed.length >= SLACK_FOLLOW_LIMIT)
          throw new FollowLimitReached();
        this.db.query("INSERT INTO followed VALUES(?,?)").run(channel, rootTs);
      })
      .immediate();
  }
  unfollow(channel: string, rootTs: string): void {
    validateSlackThread(channel, rootTs);
    this.db
      .query("DELETE FROM followed WHERE channel=? AND rootTs=?")
      .run(channel, rootTs);
  }
  followed(): { channel: string; rootTs: string }[] {
    return this.db
      .query<{ channel: string; rootTs: string }, []>(
        "SELECT * FROM followed ORDER BY channel,rootTs",
      )
      .all();
  }
  private decodeRun(row: StoredRun): WorkRun {
    return { ...row, prompt: { text: row.prompt, hash: row.hash } };
  }
  run(id: string): WorkRun | null {
    const row = this.db
      .query<StoredRun, [string]>("SELECT * FROM runs WHERE id=?")
      .get(id);
    return row ? this.decodeRun(row) : null;
  }
  delivery(id: string): Json | null {
    const row = this.db
      .query<{ request: string }, [string]>(
        "SELECT request FROM deliveries WHERE runId=?",
      )
      .get(id);
    return row ? JSON.parse(row.request) : null;
  }
  saveDelivery(id: string, request: Json): Json {
    return this.db
      .transaction(() => {
        if (!this.run(id)) throw new Error("Unknown run");
        this.db
          .query("INSERT OR IGNORE INTO deliveries VALUES(?,?)")
          .run(id, canonical(request));
        return this.delivery(id)!;
      })
      .immediate();
  }
  undispatchedRun(type: RunType): WorkRun | null {
    const row = this.db
      .query<StoredRun, [string]>(
        "SELECT * FROM runs WHERE type=? AND state IN ('pending','prepared') ORDER BY date,id LIMIT 1",
      )
      .get(type);
    return row ? this.decodeRun(row) : null;
  }
  runs(): WorkRun[] {
    return this.db
      .query<StoredRun, []>("SELECT * FROM runs ORDER BY date,id")
      .all()
      .map((row) => this.decodeRun(row));
  }
  prepareRun(
    date: string,
    type: RunType,
    prompt: PromptSnapshot,
    throughSeq: number,
  ): WorkRun {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !["morning", "pr-triage", "slack-follow-up"].includes(type) ||
      digest(prompt.text) !== prompt.hash ||
      prompt.text.length > 500_000
    )
      throw new Error("Invalid run");
    const id = `${type}:${date}`;
    return this.db
      .transaction(() => {
        if (
          !Number.isSafeInteger(throughSeq) ||
          throughSeq < 0 ||
          throughSeq > this.latestSeq()
        )
          throw new Error("Invalid run sequence");
        // Preparation can race between the CLI and service across midnight.
        // Keep the existing handoff until it has actually been dispatched.
        const outstanding = this.undispatchedRun(type);
        if (outstanding && outstanding.id !== id) return outstanding;
        this.db
          .query(
            "INSERT INTO runs VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(date,type) DO UPDATE SET prompt=excluded.prompt,hash=excluded.hash,throughSeq=excluded.throughSeq WHERE runs.state='pending'",
          )
          .run(id, date, type, prompt.text, prompt.hash, throughSeq);
        return this.run(id)!;
      })
      .immediate();
  }
  freezeRun(id: string): WorkRun {
    this.db
      .query("UPDATE runs SET state='prepared' WHERE id=? AND state='pending'")
      .run(id);
    const run = this.run(id);
    if (!run) throw new Error("Unknown run");
    return run;
  }
  markDispatched(id: string): WorkRun {
    this.db
      .query(
        "UPDATE runs SET state='dispatched' WHERE id=? AND state='prepared'",
      )
      .run(id);
    const run = this.run(id);
    if (!run || run.state === "pending" || run.state === "prepared")
      throw new Error("Run is not frozen");
    return run;
  }
  completeRun(id: string): WorkRun {
    return this.db
      .transaction(() => {
        const run = this.run(id);
        if (!run || run.state === "pending" || run.state === "prepared")
          throw new Error("Run has not been dispatched");
        if (run.state === "dispatched") {
          const consumer = `run:${run.type}`;
          const cursor = this.cursor(consumer);
          this.acknowledge(consumer, cursor, Math.max(cursor, run.throughSeq));
          this.db.query("UPDATE runs SET state='completed' WHERE id=?").run(id);
        }
        return this.run(id)!;
      })
      .immediate();
  }
}
