import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Expected a nonempty string");
  return value;
}

function preference(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected {scope,person,preference}");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["scope", "person", "preference"].includes(key)))
    throw new Error("Unknown field; expected {scope,person,preference}");
  return {
    scope: text(input.scope).trim(),
    person: text(input.person).trim(),
    preference: text(input.preference),
  };
}

try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { db: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(`Reviewer notification preferences (local only). JSON output.
Usage: bun <skill-directory>/scripts/preferences.ts [--db PATH] list [SCOPE]
       bun <skill-directory>/scripts/preferences.ts [--db PATH] set < preference.json
       bun <skill-directory>/scripts/preferences.ts [--db PATH] delete SCOPE PERSON
set schema: {scope,person,preference}, all nonempty strings. Replaces one instruction.
Scope and person are exact keys; list first and reuse them. Preference is free-form text.
Default: ~/.local/state/slopestyle/beg-for-reviews/preferences.sqlite`);
  } else {
    const [command, scope, person] = positionals;
    if (
      !(command === "list" && (positionals.length === 1 || positionals.length === 2)) &&
      !(command === "set" && positionals.length === 1) &&
      !(command === "delete" && positionals.length === 3)
    )
      throw new Error("Invalid command; use --help");
    const input = command === "set" ? preference(JSON.parse(await Bun.stdin.text())) : undefined;
    if (scope !== undefined) text(scope);
    if (person !== undefined) text(person);

    const defaultPath = join(homedir(), ".local/state/slopestyle/beg-for-reviews/preferences.sqlite");
    const path = values.db === undefined ? defaultPath : text(values.db);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (path === defaultPath) chmodSync(dirname(path), 0o700);
    const db = new Database(path, { create: true });
    try {
      chmodSync(path, 0o600);
      db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS preferences (
          scope TEXT NOT NULL, person TEXT NOT NULL, preference TEXT NOT NULL,
          PRIMARY KEY(scope,person)
        );`);
      let result: unknown;
      if (input) {
        db.query(`INSERT INTO preferences (scope,person,preference) VALUES (?,?,?)
          ON CONFLICT(scope,person) DO UPDATE SET preference=excluded.preference`)
          .run(input.scope, input.person, input.preference);
        result = { status: "saved", ...input };
      } else if (command === "delete") {
        result = { deleted: db.query("DELETE FROM preferences WHERE scope=? AND person=?").run(scope, person).changes };
      } else {
        result = scope === undefined
          ? db.query("SELECT * FROM preferences ORDER BY scope,person").all()
          : db.query("SELECT * FROM preferences WHERE scope=? ORDER BY person").all(scope);
      }
      console.log(JSON.stringify(result));
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
