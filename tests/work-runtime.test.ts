import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkRuntime,
  prepareWorkRun,
  scheduleDay,
} from "../scripts/lib/work/runtime.ts";
import { WorkStore } from "../scripts/lib/work/store.ts";
import type { WorkConfig, WorkRun } from "../scripts/lib/work/types.ts";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "work-runtime-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills/check"), { recursive: true });
  writeFileSync(join(root, "skills/check/SKILL.md"), "Read facts.");
  writeFileSync(
    join(root, "morning.md"),
    "---\nworkflows:\n  - check\n---\nMorning instructions.",
  );
  const config: WorkConfig = {
    statePath: join(root, "state.sqlite"),
    watcherUrl: "http://127.0.0.1:1",
    promptRoot: root,
    skillRoot: join(root, "skills"),
    poll: { githubMs: 1000, slackMs: 1000 },
    schedule: {
      time: "08:00",
      timezone: "Europe/Stockholm",
      weekdays: [1, 2, 3, 4, 5],
    },
  };
  return { root, config };
}
test("should catch up weekdays after eight across DST and skip weekends", () => {
  const schedule = fixture().config.schedule;
  expect(scheduleDay(new Date("2026-03-27T06:59:00Z"), schedule)).toBeNull();
  expect(scheduleDay(new Date("2026-03-27T07:00:00Z"), schedule)).toBe(
    "2026-03-27",
  );
  expect(scheduleDay(new Date("2026-03-30T06:00:00Z"), schedule)).toBe(
    "2026-03-30",
  );
  expect(scheduleDay(new Date("2026-10-26T07:00:00Z"), schedule)).toBe(
    "2026-10-26",
  );
  expect(scheduleDay(new Date("2026-03-28T20:00:00Z"), schedule)).toBeNull();
});
test("should preserve one undelivered handoff when preparation crosses midnight", async () => {
  const { config } = fixture();
  const first = new WorkStore(config.statePath);
  const second = new WorkStore(config.statePath);
  cleanups.push(
    () => first.close(),
    () => second.close(),
  );
  const results = await Promise.all([
    prepareWorkRun(
      first,
      config,
      "morning",
      "http://127.0.0.1:1234",
      new Date("2026-10-19T21:59:59Z"),
    ),
    prepareWorkRun(
      second,
      config,
      "morning",
      "http://127.0.0.1:1234",
      new Date("2026-10-19T22:00:01Z"),
    ),
  ]);
  expect(first.runs()).toHaveLength(1);
  expect(results[1]).toEqual(results[0]);
});
test("should retry frozen text after next-day restart and acknowledge only completion", async () => {
  const { root, config } = fixture();
  let store = new WorkStore(config.statePath);
  store.applySnapshot(
    "github",
    [{ key: "pr:1", data: { title: "Example" } }],
    new Date().toISOString(),
    true,
  );
  const attempts: WorkRun[] = [];
  let runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => new Date("2026-10-19T08:00:00Z"),
    deliver: async (run) => {
      attempts.push(run);
      throw new Error("offline secret");
    },
  });
  await runtime.tick();
  expect(store.cursor("run:morning")).toBe(0);
  expect(store.runs()[0].state).toBe("prepared");
  store.close();
  writeFileSync(
    join(root, "morning.md"),
    "---\nworkflows:\n  - check\n---\nChanged instructions.",
  );
  store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => new Date("2026-10-20T05:00:00Z"),
    deliver: async (run) => {
      attempts.push(run);
      return true;
    },
  });
  await runtime.tick();
  expect(attempts[1]).toEqual(attempts[0]);
  expect(store.runs()).toHaveLength(1);
  expect(store.cursor("run:morning")).toBe(0);
  store.completeRun(attempts[0].id);
  expect(store.cursor("run:morning")).toBe(1);
});
test("should coalesce collection and await inflight on stop", async () => {
  const { config } = fixture();
  const store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    collectors: {
      github: async () => {
        calls++;
        await held;
      },
      slack: async () => {},
    },
  });
  const first = runtime.refresh(),
    second = runtime.refresh();
  await Promise.resolve();
  expect(calls).toBe(1);
  let stopped = false;
  const stopping = runtime.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  await Promise.all([first, second, stopping]);
  expect(stopped).toBe(true);
});

test("should persist exact T3 request after lost receipt and override watcher target", async () => {
  const { root, config } = fixture();
  const { chmodSync } = await import("node:fs");
  const login = join(root, "codex");
  writeFileSync(
    login,
    `#!${process.execPath}\nconsole.log("Logged in using ChatGPT");\n`,
  );
  chmodSync(login, 0o700);
  const modulePath = join(root, "t3-client.ts");
  writeFileSync(
    modulePath,
    `
export const requests: unknown[] = [];
export const configs: unknown[] = [];
export async function withT3Client(config, callback) {
  configs.push(config);
  return callback({
    readThread: async () => ({ status: "found", lifecycle: "available", thread: {
      id: "thread-test", projectId: "project-test", snoozedUntil: null,
      runtimeMode: requests.length ? "full-access" : "approval-required", interactionMode: "default",
      modelSelection: { instanceId: "codex", model: requests.length ? "changed" : "original", options: [] }
    }}),
    startTurn: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw new Error("lost receipt private detail");
      return { sequence: 1 };
    }
  });
}
`,
  );
  const configPath = join(root, "watcher.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      t3Wake: {
        baseDir: root,
        appPath: root,
        threadId: "wrong-thread",
        projectId: "wrong-project",
      },
    }),
  );
  config.t3 = {
    modulePath,
    configPath,
    threadId: "thread-test",
    projectId: "project-test",
  };
  config.slack = { codexPath: login } as WorkConfig["slack"];
  let store = new WorkStore(config.statePath);
  let runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => new Date("2026-10-19T08:00:00Z"),
  });
  await runtime.tick();
  expect(runtime.status().dispatchGap).toBe(
    "T3 delivery unavailable or unverified; retry pending",
  );
  store.close();
  store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => new Date("2026-10-20T08:00:00Z"),
  });
  await runtime.tick();
  const module = await import(modulePath);
  expect(module.requests).toHaveLength(2);
  expect(module.requests[1]).toEqual(module.requests[0]);
  expect(module.requests[0].commandId).toBe(
    "slopestyle-work:morning:2026-10-19",
  );
  expect(module.requests[0].runtimeMode).toBe("approval-required");
  expect(module.configs[0].threadId).toBe("thread-test");
  expect(module.configs[0].projectId).toBe("project-test");
  expect(store.runs()[0].state).toBe("dispatched");
  expect(store.cursor("run:morning")).toBe(0);
});

test("should allow next-day report while prior dispatched run awaits completion", async () => {
  const { config } = fixture();
  const store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  let now = new Date("2026-10-19T08:00:00Z");
  const runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => now,
    deliver: async () => true,
  });
  await runtime.tick();
  await runtime.tick();
  expect(store.runs()).toHaveLength(1);
  now = new Date("2026-10-20T08:00:00Z");
  await runtime.tick();
  expect(store.runs().map((run) => run.state)).toEqual([
    "dispatched",
    "dispatched",
  ]);
  expect(store.cursor("run:morning")).toBe(0);
});

test("should await initial source evidence before first scheduled dispatch", async () => {
  const { config } = fixture();
  const store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let dispatched = false;
  const runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => new Date("2026-10-19T08:00:00Z"),
    scheduleMs: 1,
    collectors: {
      github: async () => {
        await held;
        store.applySnapshot(
          "github",
          [{ key: "initial", data: {} }],
          "2026-10-19T08:00:00Z",
          true,
        );
      },
      slack: async () => {},
    },
    deliver: async (run) => {
      expect(run.throughSeq).toBe(1);
      dispatched = true;
      return true;
    },
  });
  runtime.start();
  try {
    await Bun.sleep(10);
    expect(dispatched).toBe(false);
    expect(store.runs()).toHaveLength(0);
    release();
    for (let attempts = 0; attempts < 100 && !dispatched; attempts++)
      await Bun.sleep(1);
    expect(dispatched).toBe(true);
  } finally {
    release();
    await runtime.stop();
  }
});

test("should keep manually prepared pending runs behind the weekday eight schedule", async () => {
  const { config } = fixture();
  const store = new WorkStore(config.statePath);
  cleanups.push(() => store.close());
  let now = new Date("2026-10-18T12:00:00Z");
  let delivered = 0;
  const runtime = createWorkRuntime({
    store,
    config,
    apiUrl: "http://127.0.0.1:1234",
    now: () => now,
    deliver: async () => {
      delivered++;
      return true;
    },
  });
  await runtime.prepare("morning");

  await runtime.tick();
  expect(delivered).toBe(0);
  expect(store.runs()[0].state).toBe("pending");
  now = new Date("2026-10-19T05:59:00Z");
  await runtime.tick();
  expect(delivered).toBe(0);

  now = new Date("2026-10-19T06:00:00Z");
  await runtime.tick();
  expect(delivered).toBe(1);
});
