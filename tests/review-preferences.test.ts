import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "review-preferences."));
const script = resolve(import.meta.dir, "../skills/beg-for-reviews/scripts/preferences.ts");
const path = join(scratch, "private/preferences.sqlite");
function cli(args: string[], input?: unknown) {
  return Bun.spawnSync([process.execPath, script, "--db", path, ...args], {
    stdin: input === undefined ? undefined : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
}
function run(args: string[], input?: unknown) {
  const result = cli(args, input);
  if (result.exitCode) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("should persist, replace and forget free-form instructions within their scope across CLI processes", () => {
  const first = {
    scope: "github.com/example",
    person: "github:alex-example",
    preference: "Mention <@U-example> in #reviews on Slack. Keep 'quoted' text and 🐈.\nThen request alex-example on GitHub for Linear.",
  };
  const other = { ...first, scope: "github.com/other", preference: "GitHub only." };
  expect(run(["list"])).toEqual([]);
  expect(run(["set"], first)).toEqual({ status: "saved", ...first });
  run(["set"], other);
  expect(run(["list"])).toEqual([first, other]);
  const updated = { ...first, preference: "Slack only." };
  run(["set"], updated);
  expect(run(["list", first.scope])).toEqual([updated]);
  expect(run(["delete", first.scope, first.person])).toEqual({ deleted: 1 });
  expect(run(["delete", first.scope, first.person])).toEqual({ deleted: 0 });
  expect(run(["list"])).toEqual([other]);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(scratch, "private")).mode & 0o777).toBe(0o700);
});

test("should reject malformed writes and commands without changing saved preferences", () => {
  const before = run(["list"]);
  for (const input of [
    null,
    [],
    { scope: "example", person: "alex", preference: "   " },
    { scope: "example", person: "alex" },
    { scope: 42, person: "alex", preference: "Slack" },
    { scope: "example", person: "alex", preference: "Slack", typo: true },
  ]) {
    expect(cli(["set"], input).exitCode).toBe(1);
  }
  expect(cli(["delete", "example"]).exitCode).toBe(1);
  expect(cli(["list", "example", "extra"]).exitCode).toBe(1);
  expect(run(["list"])).toEqual(before);
});
