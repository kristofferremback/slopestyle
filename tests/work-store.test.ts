import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkStore } from "../scripts/lib/work/store.ts";
import { digest } from "../scripts/lib/work/prompts.ts";

test("should persist snapshots, independent acknowledgements, health and followed threads across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-store-"));
  let store = new WorkStore(join(dir, "state.sqlite"));
  try {
    store.applySnapshot(
      "github",
      [{ key: "repo/1", data: { title: "one" } }],
      "2026-01-01",
      true,
    );
    store.applySnapshot(
      "github",
      [{ key: "repo/1", data: { title: "one" } }],
      "2026-01-02",
      true,
    );
    expect(store.latestSeq()).toBe(1);

    store.fail("github", "2026-01-03");
    expect(store.health("github")).toEqual({
      source: "github",
      attemptedAt: "2026-01-03",
      succeededAt: "2026-01-02",
      gap: "Collection failed",
    });

    store.follow("C001", "1700000000.000001");
    expect(store.acknowledge("morning", 0, 1)).toBe(true);
    expect(store.acknowledge("morning", 0, 1)).toBe(false);
    expect(() => store.acknowledge("other", 0, 2)).toThrow();

    store.close();
    store = new WorkStore(join(dir, "state.sqlite"));
    expect(store.followed()).toEqual([
      { channel: "C001", rootTs: "1700000000.000001" },
    ]);
    expect([
      store.cursor("morning"),
      store.cursor("other"),
      store.records().length,
    ]).toEqual([1, 0, 1]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("should remove omitted PRs only for complete snapshots and retain absent Slack threads", () => {
  const store = new WorkStore(":memory:");
  try {
    for (const source of ["github", "slack"] as const)
      store.applySnapshot(
        source,
        [{ key: "item", data: { open: true } }],
        "a",
        true,
      );
    store.applySnapshot("github", [], "b", false);
    expect(store.records("github")).toHaveLength(1);
    store.applySnapshot("github", [], "c", true);
    store.applySnapshot("slack", [], "c", true);
    expect(store.records().map((r) => r.source)).toEqual(["slack"]);
    expect(store.changes(2)).toMatchObject([
      { seq: 3, kind: "remove", source: "github" },
    ]);
    expect(() =>
      store.applySnapshot(
        "slack",
        [
          { key: "x", data: null },
          { key: "x", data: 1 },
        ],
        "d",
        true,
      ),
    ).toThrow();
    expect(store.latestSeq()).toBe(3);
  } finally {
    store.close();
  }
});
test("should freeze dispatch retries and acknowledge only explicit completion", () => {
  const store = new WorkStore(":memory:");
  try {
    store.applySnapshot("github", [{ key: "one", data: null }], "a", true);
    const snapshot = (text: string) => ({ text, hash: digest(text) });
    let run = store.prepareRun("2026-01-01", "morning", snapshot("first"), 1);
    run = store.prepareRun(run.date, run.type, snapshot("refresh"), 1);
    expect(run.prompt.text).toBe("refresh");

    store.freezeRun(run.id);
    expect(
      store.prepareRun(run.date, run.type, snapshot("changed"), 1).prompt.text,
    ).toBe("refresh");
    expect(() => store.completeRun(run.id)).toThrow();

    store.markDispatched(run.id);
    expect(store.cursor("run:morning")).toBe(0);

    expect(store.completeRun(run.id).state).toBe("completed");
    expect(store.cursor("run:morning")).toBe(1);
  } finally {
    store.close();
  }
});

test("should reject non-JSON snapshots before writing records or source health", () => {
  const store = new WorkStore(":memory:");
  try {
    store.applySnapshot(
      "github",
      [{ key: "existing", data: true }],
      "first",
      true,
    );
    for (const data of [
      Array(2),
      new Date(),
    ] as unknown as import("../scripts/lib/work/types.ts").Json[]) {
      expect(() =>
        store.applySnapshot(
          "github",
          [
            { key: "valid", data: null },
            { key: "invalid", data },
          ],
          "later",
          true,
        ),
      ).toThrow();
    }
    expect(store.latestSeq()).toBe(1);
    expect(store.records().map((record) => record.key)).toEqual(["existing"]);
    store.applySnapshot("github", [], "bounded", false);
    expect(store.health("github")).toEqual({
      source: "github",
      attemptedAt: "bounded",
      succeededAt: "first",
      gap: "Incomplete snapshot",
    });
  } finally {
    store.close();
  }
});

test("should retain frozen prompt across restart and arbitrate acknowledgements between connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-store-"));
  const path = join(dir, "state.sqlite");
  const first = new WorkStore(path);
  const second = new WorkStore(path);
  try {
    first.applySnapshot("github", [{ key: "one", data: null }], "first", true);
    const run = first.prepareRun(
      "2026-01-01",
      "morning",
      { text: "original", hash: digest("original") },
      1,
    );
    first.freezeRun(run.id);
    expect(
      second.prepareRun(
        run.date,
        run.type,
        { text: "edited", hash: digest("edited") },
        0,
      ).prompt.text,
    ).toBe("original");
    expect(first.acknowledge("shared", 0, 1)).toBe(true);
    expect(second.acknowledge("shared", 0, 1)).toBe(false);
    expect(second.run(run.id)?.state).toBe("prepared");
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should return the immutable delivery winner across connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-delivery-"));
  const first = new WorkStore(join(dir, "state.sqlite"));
  const second = new WorkStore(join(dir, "state.sqlite"));
  try {
    const run = first.prepareRun(
      "2026-01-01",
      "morning",
      { text: "prompt", hash: digest("prompt") },
      0,
    );
    const winner = { model: "original", createdAt: "first" };
    const contender = { model: "changed", createdAt: "later" };

    expect(first.saveDelivery(run.id, winner)).toEqual(winner);
    expect(second.saveDelivery(run.id, contender)).toEqual(winner);
    expect(second.delivery(run.id)).toEqual(winner);
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should validate follows and atomically enforce capacity across connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-follows-"));
  const first = new WorkStore(join(dir, "state.sqlite"));
  const second = new WorkStore(join(dir, "state.sqlite"));
  try {
    expect(() => first.follow("bad", "1700000000.000001")).toThrow(
      "Invalid Slack thread",
    );
    expect(() => first.unfollow("C123", "123.456")).toThrow(
      "Invalid Slack thread",
    );
    for (let index = 0; index < 100; index++)
      first.follow(`C${index}`, "1700000000.000001");

    second.follow("C0", "1700000000.000001");
    expect(() => second.follow("CNEW", "1700000000.000001")).toThrow(
      "Follow limit reached",
    );
    second.unfollow("C0", "1700000000.000001");
    second.unfollow("C0", "1700000000.000001");
    first.follow("CNEW", "1700000000.000001");
    expect(first.followed()).toHaveLength(100);
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
