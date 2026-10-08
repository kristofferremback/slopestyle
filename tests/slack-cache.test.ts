import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FRESH_MS, openCache } from "../skills/use-slack/scripts/cache.ts";

const scratch = mkdtempSync(join(tmpdir(), "slack-cache."));
const script = resolve(import.meta.dir, "../skills/use-slack/scripts/cache.ts");
const now = Date.now();
const scope = { workspace: "W-fixture", account: "U-self" };
const entry = (id = "U-1", name = "Alex", verifiedAt = now) => ({
  kind: "person",
  id,
  name,
  aliases: [id === "U-1" ? "alex-old" : `alias-${id}`],
  active: true,
  verifiedAt,
});
const payload = (entries = [entry()], verifiedAt = now) => ({
  ...scope,
  workspaceName: "Fixture",
  verifiedAt,
  entries,
});
function cli(path: string, args: string[], input?: unknown) {
  const result = Bun.spawnSync(["bun", script, "--db", path, ...args], {
    stdin:
      input === undefined
        ? undefined
        : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("should reuse directory evidence across independent CLI processes", () => {
  const path = join(scratch, "warm/cache.sqlite");
  expect(cli(path, ["context"])).toEqual({ incomplete: true, scopes: [] });
  cli(path, ["remember"], payload());
  expect(
    cli(path, ["resolve", scope.workspace, scope.account, "person", "Alex"])
      .status,
  ).toBe("resolved");
  expect(
    cli(path, ["context", scope.workspace, scope.account]).scope.workspaceName,
  ).toBe("Fixture");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(scratch, "warm")).mode & 0o777).toBe(0o700);
});

test("should distinguish scope, ambiguity, stale and inactive evidence", () => {
  const cache = openCache(join(scratch, "states/cache.sqlite"));
  try {
    cache.remember(
      payload([
        entry(),
        entry("U-2"),
        entry("U-old", "Old", now - FRESH_MS - 1),
        { ...entry("U-inactive", "Inactive"), active: false },
      ]),
    );
    expect(cache.resolve(scope, "person", "Alex").status).toBe("ambiguous");
    expect(cache.resolve(scope, "person", "Old").status).toBe("stale");
    expect(cache.resolve(scope, "person", "Inactive").status).toBe("inactive");
    expect(
      cache.resolve({ ...scope, account: "other" }, "person", "Alex").status,
    ).toBe("miss");
    expect(
      cache.resolve({ ...scope, workspace: "other" }, "person", "Alex").status,
    ).toBe("miss");
    expect(cache.resolve(scope, "channel", "Alex").status).toBe("miss");
    expect(cache.resolve(scope, "person", "Ale").status).toBe("miss");
    expect(cache.resolve(scope, "person", "Ale").suggestions.length).toBe(2);
  } finally {
    cache.close();
  }
});

test("should atomically reject invalid data and replace aliases without accepting delayed refreshes", () => {
  const cache = openCache(join(scratch, "updates/cache.sqlite"));
  try {
    cache.remember(payload());
    expect(() =>
      cache.remember(
        payload([
          entry("U-new"),
          { ...entry(), content: "forbidden" } as ReturnType<typeof entry>,
        ]),
      ),
    ).toThrow("Unknown field");
    expect(cache.resolve(scope, "person", "U-new").status).toBe("miss");
    expect(() => cache.remember({ ...payload(), token: "forbidden" })).toThrow(
      "Unknown field",
    );
    expect(
      cache.remember(
        payload([{ ...entry("U-1", "Renamed"), aliases: ["new-alias"] }]),
      ),
    ).toEqual({ status: "remembered", entries: 1, applied: 1 });
    expect(
      cache.remember(payload([entry("U-1", "Delayed", now - 1000)], now - 1000)),
    ).toEqual({ status: "remembered", entries: 1, applied: 0 });
    expect(cache.resolve(scope, "person", "Renamed").status).toBe("resolved");
    expect(cache.resolve(scope, "person", "alex-old").status).toBe("miss");
    cache.remember(payload([]));
    expect(cache.resolve(scope, "person", "new-alias").status).toBe("resolved");
  } finally {
    cache.close();
  }
});

test("should preserve concurrent imports and bound selected context", async () => {
  const path = join(scratch, "concurrent/cache.sqlite");
  const initial = openCache(path);
  initial.remember(payload([entry(scope.account, "Self", now - 1000)]));
  initial.close();
  const children = Array.from({ length: 6 }, (_, index) => {
    const child = Bun.spawn(["bun", script, "--db", path, "remember"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(
      JSON.stringify(
        payload(
          Array.from({ length: 5 }, (_, offset) =>
            entry(`U-${index}-${offset}`, `Name-${index}-${offset}`),
          ),
        ),
      ),
    );
    child.stdin.end();
    return child;
  });
  for (const child of children) {
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  }
  expect(
    cli(path, ["context", scope.workspace, scope.account]).entries.length,
  ).toBe(20);
  expect(cli(path, ["context", scope.workspace, scope.account]).self.id).toBe(
    scope.account,
  );
  for (let index = 0; index < 6; index++)
    expect(
      cli(path, [
        "resolve",
        scope.workspace,
        scope.account,
        "person",
        `U-${index}-0`,
      ]).status,
    ).toBe("resolved");
});

test("should preserve permissions of an existing override parent", () => {
  const parent = join(scratch, "existing-parent");
  mkdirSync(parent);
  chmodSync(parent, 0o755);
  const cache = openCache(join(parent, "cache.sqlite"));
  cache.close();
  expect(statSync(parent).mode & 0o777).toBe(0o755);
});
