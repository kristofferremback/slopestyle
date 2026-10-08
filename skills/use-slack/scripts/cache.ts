import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
type Kind = "person" | "channel";
interface Scope {
  workspace: string;
  account: string;
}
interface Entry {
  kind: Kind;
  id: string;
  name: string;
  aliases: string[];
  active: boolean;
  verifiedAt: number;
}
interface Observation extends Scope {
  workspaceName?: string;
  verifiedAt: number;
  entries: Entry[];
}
interface Row extends Entry {
  workspace: string;
  account: string;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error("Unknown field");
  return result;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256)
    throw new Error("Expected nonempty string up to 256 characters");
  return value;
}
function timestamp(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Date.now()
  )
    throw new Error("Invalid observation timestamp");
  return value;
}
function observation(value: unknown): Observation {
  const input = object(value, [
    "workspace",
    "account",
    "workspaceName",
    "verifiedAt",
    "entries",
  ]);
  if (!Array.isArray(input.entries) || input.entries.length > 1000)
    throw new Error("Expected at most 1000 entries");
  const verifiedAt = timestamp(input.verifiedAt);
  return {
    workspace: string(input.workspace),
    account: string(input.account),
    verifiedAt,
    ...(input.workspaceName === undefined
      ? {}
      : { workspaceName: string(input.workspaceName) }),
    entries: input.entries.map((value) => {
      const entry = object(value, [
        "kind",
        "id",
        "name",
        "aliases",
        "active",
        "verifiedAt",
      ]);
      if (entry.kind !== "person" && entry.kind !== "channel")
        throw new Error("Invalid kind");
      if (
        typeof entry.active !== "boolean" ||
        !Array.isArray(entry.aliases) ||
        entry.aliases.length > 30
      )
        throw new Error("Invalid active/aliases");
      const entryTime = timestamp(entry.verifiedAt);
      if (entryTime > verifiedAt)
        throw new Error("Entry observation exceeds import observation");
      return {
        kind: entry.kind,
        id: string(entry.id),
        name: string(entry.name),
        aliases: [...new Set(entry.aliases.map(string))],
        active: entry.active,
        verifiedAt: entryTime,
      };
    }),
  };
}
const normalize = (value: string): string =>
  value.trim().replace(/^[@#]/, "").toLowerCase();
const defaultPath = () =>
  join(homedir(), ".local/state/slopestyle/slack/cache.sqlite");
export function openCache(path = defaultPath()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (path === defaultPath()) chmodSync(dirname(path), 0o700);
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS scopes (workspace TEXT, account TEXT, workspaceName TEXT, verifiedAt INTEGER NOT NULL, PRIMARY KEY(workspace,account));
    CREATE TABLE IF NOT EXISTS entries (workspace TEXT, account TEXT, kind TEXT, id TEXT, name TEXT, aliases TEXT, active INTEGER, verifiedAt INTEGER, PRIMARY KEY(workspace,account,kind,id));`);
  function rows(scope: Scope): Row[] {
    const values = db
      .query(
        "SELECT * FROM entries WHERE workspace=? AND account=? ORDER BY verifiedAt DESC,kind,id",
      )
      .all(scope.workspace, scope.account) as (Omit<
      Row,
      "aliases" | "active"
    > & { aliases: string; active: number })[];
    return values.map((row) => ({
      ...row,
      aliases: JSON.parse(row.aliases) as string[],
      active: Boolean(row.active),
    }));
  }
  function view(row: Row, now: number) {
    return {
      ...row,
      ageMs: Math.max(0, now - row.verifiedAt),
      stale: now - row.verifiedAt > FRESH_MS,
    };
  }
  return {
    close: () => db.close(),
    remember(value: unknown) {
      const input = observation(value);
      let applied = 0;
      db.transaction(() => {
        db.query(
          `INSERT INTO scopes (workspace,account,workspaceName,verifiedAt) VALUES (?,?,?,?) ON CONFLICT(workspace,account) DO UPDATE SET workspaceName=COALESCE(excluded.workspaceName,scopes.workspaceName), verifiedAt=excluded.verifiedAt WHERE excluded.verifiedAt>=scopes.verifiedAt`,
        ).run(
          input.workspace,
          input.account,
          input.workspaceName ?? null,
          input.verifiedAt,
        );
        for (const entry of input.entries)
          applied += db
            .query(
              `INSERT INTO entries (workspace,account,kind,id,name,aliases,active,verifiedAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace,account,kind,id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,active=excluded.active,verifiedAt=excluded.verifiedAt WHERE excluded.verifiedAt>=entries.verifiedAt`,
            )
            .run(
              input.workspace,
              input.account,
              entry.kind,
              entry.id,
              entry.name,
              JSON.stringify(entry.aliases),
              Number(entry.active),
              entry.verifiedAt,
            ).changes;
      })();
      return { status: "remembered", entries: input.entries.length, applied };
    },
    context(scope?: Scope, now = Date.now()) {
      if (!scope)
        return {
          incomplete: true,
          scopes: db
            .query("SELECT * FROM scopes ORDER BY workspace,account LIMIT 50")
            .all(),
        };
      const directory = rows(scope);
      const self = directory.find(
        (row) => row.kind === "person" && row.id === scope.account,
      );
      return {
        incomplete: true,
        scope: db
          .query("SELECT * FROM scopes WHERE workspace=? AND account=?")
          .get(scope.workspace, scope.account),
        self: self ? view(self, now) : null,
        entries: directory.slice(0, 20).map((row) => view(row, now)),
      };
    },
    resolve(scope: Scope, kind: Kind, query: string, now = Date.now()) {
      const all = rows(scope).filter((row) => row.kind === kind);
      const target = normalize(query);
      const matches = all.filter((row) =>
        [row.id, row.name, ...row.aliases].some(
          (name) => normalize(name) === target,
        ),
      );
      const status =
        matches.length > 1
          ? "ambiguous"
          : matches.length === 0
            ? "miss"
            : !matches[0].active
              ? "inactive"
              : now - matches[0].verifiedAt > FRESH_MS
                ? "stale"
                : "resolved";
      return {
        status,
        matches: matches.map((row) => view(row, now)),
        suggestions: matches.length
          ? []
          : all
              .filter((row) =>
                [row.name, ...row.aliases].some((name) =>
                  normalize(name).includes(target),
                ),
              )
              .slice(0, 5)
              .map((row) => view(row, now)),
      };
    },
  };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
      console.log(`Slack directory cache (no network). JSON output; 7-day freshness, incomplete directory.
Usage: bun <skill-directory>/scripts/cache.ts [--db TEST_PATH] context [WORKSPACE ACCOUNT]
       bun <skill-directory>/scripts/cache.ts [--db TEST_PATH] resolve WORKSPACE ACCOUNT person|channel QUERY
       bun <skill-directory>/scripts/cache.ts [--db TEST_PATH] remember < observation.json
remember schema: {workspace,account,workspaceName?,verifiedAt,entries:[{kind,id,name,aliases,active,verifiedAt}]}
Times are observed Unix milliseconds. Unknown fields are rejected; imports are atomic and replace aliases per updated entry.`);
    } else {
      const index = args.indexOf("--db");
      const path = index < 0 ? undefined : args.splice(index, 2)[1];
      if (index >= 0 && !path) throw new Error("--db needs a path");
      const [command, workspace, account, kind, query] = args;
      if (
        !(command === "context" && (args.length === 1 || args.length === 3)) &&
        !(command === "remember" && args.length === 1) &&
        !(
          command === "resolve" &&
          args.length === 5 &&
          (kind === "person" || kind === "channel")
        )
      )
        throw new Error("Invalid command; use --help");
      const cache = openCache(path);
      try {
        const result =
          command === "remember"
            ? cache.remember(JSON.parse(await Bun.stdin.text()))
            : command === "context"
              ? cache.context(
                  workspace
                    ? { workspace: string(workspace), account: string(account) }
                    : undefined,
                )
              : cache.resolve(
                  { workspace: string(workspace), account: string(account) },
                  kind as Kind,
                  string(query),
                );
        console.log(JSON.stringify(result));
      } finally {
        cache.close();
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
