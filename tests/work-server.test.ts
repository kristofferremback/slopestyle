import { afterEach, expect, test } from "bun:test";
import { WorkStore } from "../scripts/lib/work/store.ts";
import { createWorkServer } from "../scripts/lib/work/server.ts";
import type { WorkConfig } from "../scripts/lib/work/types.ts";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture() {
  const store = new WorkStore(":memory:");
  const config = {
    promptRoot: "/missing",
    skillRoot: "/missing",
  } as WorkConfig;
  const server = createWorkServer({ store, config, port: 0 });
  cleanups.push(
    () => store.close(),
    () => server.stop(true),
  );
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, value: unknown, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  return { store, base, post };
}
test("should expose independent reads and CAS acknowledgement through HTTP", async () => {
  const { store, base, post } = fixture();
  store.applySnapshot(
    "github",
    [
      { key: "one", data: { title: "<script>data</script>" } },
      { key: "two", data: {} },
    ],
    "2026-10-19T08:00:00Z",
    true,
  );
  const read = await (
    await fetch(base + "/api/changes?consumer=alpha&limit=1")
  ).json();
  expect(read.nextCursor).toBe(1);
  expect(store.cursor("alpha")).toBe(0);
  expect(
    (await post("/api/ack", { consumer: "alpha", expected: 0, through: 1 }))
      .status,
  ).toBe(200);
  expect(
    (await post("/api/ack", { consumer: "alpha", expected: 0, through: 2 }))
      .status,
  ).toBe(409);
  expect(store.cursor("beta")).toBe(0);
  const capped = await (
    await fetch(base + "/api/changes?consumer=beta&through=1")
  ).json();
  expect(capped.changes).toHaveLength(1);
  const beyond = await (
    await fetch(base + "/api/changes?consumer=beta&after=999")
  ).json();
  expect(beyond.nextCursor).toBe(2);
});
test("should reject hostile origins and validate follow atomically", async () => {
  const { store, base, post } = fixture();
  expect(
    (
      await post(
        "/api/follow",
        { channel: "CEXAMPLE", rootTs: "1700000000.000001" },
        { Origin: "https://example.com" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await fetch(base + "/api/status", { headers: { Host: "evil.example" } }))
      .status,
  ).toBe(403);
  expect(
    (await post("/api/follow", { channel: "CEXAMPLE", rootTs: "invalid" }))
      .status,
  ).toBe(400);
  expect(store.followed()).toEqual([]);
  expect(
    (
      await post("/api/follow", {
        channel: "CEXAMPLE",
        rootTs: "1700000000.000001",
      })
    ).status,
  ).toBe(200);
  expect(store.followed()).toEqual([
    { channel: "CEXAMPLE", rootTs: "1700000000.000001" },
  ]);
  expect(
    (await post("/api/unfollow", { channel: "CEXAMPLE", rootTs: "invalid" }))
      .status,
  ).toBe(400);
  expect(store.followed()).toHaveLength(1);
  expect((await fetch(base + "/api/status", { method: "DELETE" })).status).toBe(
    405,
  );
});
test("should retain source facts and sanitize failed prompt reads", async () => {
  const { store, base } = fixture();
  store.applySnapshot(
    "slack",
    [{ key: "message:C1:1.2", data: { text: "fact" } }],
    "2026-10-19T08:00:00Z",
    false,
  );
  store.fail("slack", "2026-10-19T08:01:00Z", "Unavailable");
  const status = await (await fetch(base + "/api/status")).json();
  expect(status.records.slack[0].data).toEqual({ text: "fact" });
  expect(status.health.slack.gap).toBe("Unavailable");
  expect(await (await fetch(base + "/api/prompts/morning")).json()).toEqual({
    error: "Request failed",
  });
});

test("should report follow capacity as conflict and allow repeated follows", async () => {
  const { store, post } = fixture();
  for (let index = 0; index < 100; index++)
    store.follow(`C${index}`, "1700000000.000001");

  expect(
    (
      await post("/api/follow", {
        channel: "CNEW",
        rootTs: "1700000000.000001",
      })
    ).status,
  ).toBe(409);
  expect(
    (await post("/api/follow", { channel: "C0", rootTs: "1700000000.000001" }))
      .status,
  ).toBe(200);
  expect(
    (await post("/api/follow", { channel: "CNEW", rootTs: "123.456" })).status,
  ).toBe(400);
  expect(store.followed()).toHaveLength(100);
});

test("should constrain local snoozes and return coherent status without source changes", async () => {
  const { store, base, post } = fixture();
  store.applySnapshot("github", [{ key: "pr:1", data: { title: "literal" } }], "a", true);
  const before = store.records();
  for (const durationHours of [0, 2, "24", null]) expect((await post("/api/snooze", { key: "pr:1", expected: 0, durationHours })).status).toBe(400);
  expect((await post("/api/snooze", { key: "missing", expected: 0, durationHours: 1 })).status).toBe(400);
  expect((await post("/api/snooze", { key: "pr:1", expected: 0, durationHours: 1 }, { Origin: "https://evil.example" })).status).toBe(403);
  expect((await post("/api/snooze", { key: "pr:1", expected: 0, durationHours: 1 }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  const result = await (await post("/api/snooze", { key: "pr:1", expected: 0, durationHours: 24 })).json();
  expect(result.snoozes[0]).toMatchObject({ key: "pr:1", version: 1, durationHours: 24 });
  expect(result.records.github).toEqual(before);
  expect((await post("/api/restore", { key: "pr:1", expected: 0 })).status).toBe(409);
  for (const path of ["/api/snooze", "/api/restore"]) {
    for (const expected of [-1, 0.5, "1", null]) expect((await post(path, { key: "pr:1", expected, durationHours: 1 })).status).toBe(400);
    for (const key of ["", null, "missing"]) expect((await post(path, { key, expected: 1, durationHours: 1 })).status).toBe(400);
    expect((await post(path, { key: "pr:1", expected: 1, durationHours: 1 }, { Origin: "https://evil.example" })).status).toBe(403);
  }
  // Restore owns its meaning even when a client supplies a snooze duration.
  expect((await post("/api/restore", { key: "pr:1", expected: 1, durationHours: 24 })).status).toBe(200);
  const status = await (await fetch(base + "/api/status")).json();
  expect(status.snoozes).toEqual([{ key: "pr:1", version: 2, until: null, durationHours: null }]);
  expect(status.latestSeq).toBe(1);
  expect(store.records()).toEqual(before);
});
