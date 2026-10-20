import { expect, test } from "bun:test";
import { WorkStore } from "../scripts/lib/work/store.ts";
import { collectGithub, collectSlack } from "../scripts/lib/work/collect.ts";
import {
  SLACK_APP,
  SLACK_TOOLS,
  verifySlackTools,
} from "../scripts/lib/work/managed-apps.ts";
import type { WorkConfig } from "../scripts/lib/work/types.ts";
const now = new Date("2026-10-19T10:00:00Z");
const cfg: WorkConfig = {
  statePath: ":memory:",
  watcherUrl: "http://127.0.0.1:1234",
  promptRoot: "/tmp",
  skillRoot: "/tmp",
  poll: { githubMs: 60000, slackMs: 60000 },
  slack: {
    email: "agent@example.com",
    workspace: "T123",
    user: "U123",
    discoveryQuery: "in:work",
    codexPath: "codex",
  },
  schedule: { time: "08:00", timezone: "Europe/Stockholm", weekdays: [1] },
};
function watcher(at = now.toISOString()) {
  return {
    ok: true,
    lastSuccessfulPoll: at,
    lastError: null,
    myPullRequests: [
      {
        key: "org/repo#1",
        number: 1,
        title: "Change",
        url: "https://github.com/org/repo/pull/1",
        repository: "org/repo",
        head: "abc",
        owned: true,
        requested: false,
        hidden: false,
        draft: false,
        status: "approved",
        review: { threadUrl: "" },
      },
    ],
    queue: [],
    hidden: [],
  };
}
test("should preserve watcher evidence and upstream success when response is stale", async () => {
  const store = new WorkStore(":memory:");
  await collectGithub(store, cfg, {
    now,
    fetcher: async (_url, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      return Response.json(watcher("2026-10-19T09:59:00Z"));
    },
  });
  expect(store.health("github").succeededAt).toBe("2026-10-19T09:59:00Z");
  const seq = store.latestSeq();
  await collectGithub(store, cfg, {
    now,
    fetcher: async () => Response.json(watcher("2026-10-18T00:00:00Z")),
  });
  expect(store.latestSeq()).toBe(seq);
  expect(store.records("github")).toHaveLength(1);
  expect(store.health("github").gap).toContain("stale");
  store.close();
});
test("should refuse connector owner mismatch before source calls", () => {
  const tools = Object.fromEntries(
    SLACK_TOOLS.map((name) => [
      name,
      {
        annotations: { readOnlyHint: true, destructiveHint: false },
        _meta: {
          connector_id: SLACK_APP,
          link_owner_profile: { email: cfg.slack!.email, id: "T123:U999" },
        },
      },
    ]),
  );
  expect(() => verifySlackTools(tools, cfg.slack!)).toThrow("unverified");
});
test("should retain later replies and previous evidence when one followed thread fails", async () => {
  const store = new WorkStore(":memory:");
  store.follow("C123", "1700000000.000001");
  let later = false,
    fail = false;
  const calls: string[] = [];
  const openSession = async () => ({
    async call(tool: string) {
      calls.push(tool);
      if (tool.endsWith("slack_search_public_and_private"))
        return { results: "## Messages (0 results)", pagination_info: "" };
      if (fail) throw new Error("secret provider detail");
      return {
        messages: `From: Person\nTime: today\nMessage TS: 1700000000.000001\nRoot${later ? "\nFrom: Other\nTime: later\nMessage TS: 1700000010.000001\nLater reply" : ""}`,
        pagination_info: "There are no more messages in this thread.",
      };
    },
    async close() {},
  });
  await collectSlack(store, cfg, { now, openSession });
  const seq = store.latestSeq();
  await collectSlack(store, cfg, { now, openSession });
  expect(store.latestSeq()).toBe(seq);
  later = true;
  await collectSlack(store, cfg, { now, openSession });
  expect(JSON.stringify(store.records())).toContain("Later reply");
  fail = true;
  await collectSlack(store, cfg, { now, openSession });
  expect(JSON.stringify(store.records())).toContain("Later reply");
  expect(store.health("slack").gap).toContain("failed");
  expect(store.health("slack").gap).not.toContain("secret");
  expect(calls.every((c) => SLACK_TOOLS.includes(c))).toBe(true);
  store.close();
});
test("should reject empty thread evidence without inventing a root", async () => {
  const store = new WorkStore(":memory:");
  store.follow("C123", "1700000000.000001");
  await collectSlack(store, cfg, {
    now,
    openSession: async () => ({
      async call(tool) {
        return tool.endsWith("slack_read_thread")
          ? {
              messages: "",
              pagination_info: "There are no more messages in this thread.",
            }
          : { results: "## Messages (0 results)", pagination_info: "" };
      },
      async close() {},
    }),
  });
  expect(store.records()).toEqual([]);
  expect(store.health("slack").succeededAt).toBeNull();
  expect(store.health("slack").gap).toContain("failed");
  store.close();
});

test("should execute only verified direct read RPC through an ephemeral subprocess", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openManagedSession } =
    await import("../scripts/lib/work/managed-apps.ts");
  const dir = mkdtempSync(join(tmpdir(), "work-rpc-test-"));
  const cli = join(dir, "codex");
  writeFileSync(
    cli,
    `#!/usr/bin/env bun
if (process.argv.includes("login")) {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
await Bun.write(${JSON.stringify(join(dir, "pid"))}, String(process.pid));
let inventoried = false;
const tools = Object.fromEntries(${JSON.stringify(SLACK_TOOLS)}.map(name => [name, {
  annotations: { readOnlyHint: true, destructiveHint: false },
  _meta: {
    connector_id: ${JSON.stringify(SLACK_APP)},
    link_owner_profile: { email: "agent@example.com", id: "T123:U123" },
  },
}]));
let pending = "";
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk);
  let newline;
  while ((newline = pending.indexOf("\\n")) >= 0) {
    const message = JSON.parse(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
    let result;
    if (message.method === "initialize") result = {};
    else if (message.method === "thread/start" && message.params.ephemeral && message.params.sandbox === "read-only")
      result = { thread: { id: "ephemeral" } };
    else if (message.method === "mcpServerStatus/list") {
      inventoried = true;
      result = { data: [{ name: "codex_apps", tools }] };
    } else if (inventoried && message.method === "mcpServer/tool/call" && message.params.server === "codex_apps" && tools[message.params.tool])
      result = { structuredContent: { results: "## Messages (0 results)", pagination_info: "" } };
    else {
      console.log(JSON.stringify({ id: message.id, error: { code: -1 } }));
      continue;
    }
    console.log(JSON.stringify({ id: message.id, result }));
  }
}
`,
    { mode: 0o700 },
  );
  try {
    const session = await openManagedSession({ ...cfg.slack!, codexPath: cli });
    try {
      expect(await session.call(SLACK_TOOLS[0], {})).toEqual({
        results: "## Messages (0 results)",
        pagination_info: "",
      });
      await expect(session.call("turn/start", {})).rejects.toThrow();
    } finally {
      await session.close();
    }
    const pid = Number(await Bun.file(join(dir, "pid")).text());
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should refuse API key authentication before starting an app server", async () => {
  const { mkdtempSync, writeFileSync, rmSync, existsSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openManagedSession } =
    await import("../scripts/lib/work/managed-apps.ts");
  const dir = mkdtempSync(join(tmpdir(), "work-auth-test-"));
  const cli = join(dir, "codex"),
    marker = join(dir, "started");
  writeFileSync(
    cli,
    `#!/usr/bin/env bun\nif(process.argv.includes('login')){console.log('Logged in using an API key');process.exit(0)}\nawait Bun.write(${JSON.stringify(marker)},'unexpected');`,
    { mode: 0o700 },
  );
  try {
    await expect(
      openManagedSession({ ...cfg.slack!, codexPath: cli }),
    ).rejects.toThrow("unverified");
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should allow upstream watcher cadence independently of consumer polling", async () => {
  const store = new WorkStore(":memory:");
  await collectGithub(store, cfg, {
    now,
    fetcher: async () => Response.json(watcher("2026-10-19T09:50:00Z")),
  });
  expect(store.health("github").succeededAt).toBe("2026-10-19T09:50:00Z");
  expect(store.records("github")).toHaveLength(1);
  store.close();
});

test("should paginate followed threads and preserve success when coverage is incomplete", async () => {
  const { readFollowedThread } = await import("../scripts/lib/work/slack.ts");
  const args: any[] = [];
  const session = {
    async call(_tool: string, input: any) {
      args.push(input);
      return {
        messages: `From: Person\nTime: today\nMessage TS: ${input.cursor ? "1700000010.000001" : "1700000000.000001"}\n${input.cursor ? "Later reply" : "Root"}`,
        pagination_info: input.cursor
          ? "There are no more messages in this thread."
          : "Next cursor: `next`",
      };
    },
    async close() {},
  };
  const thread = await readFollowedThread(
    session,
    cfg.slack!,
    "C123",
    "1700000000.000001",
  );
  expect(thread.complete).toBe(true);
  expect(thread.text).toContain("Later reply");
  expect(args.map((a) => a.cursor ?? null)).toEqual([null, "next"]);
  const store = new WorkStore(":memory:");
  store.follow("C123", "1700000000.000001");
  store.applySnapshot(
    "slack",
    [{ key: "thread:C123:1700000000.000001", data: thread as any }],
    now.toISOString(),
    false,
    { succeededAt: now.toISOString() },
  );
  await collectSlack(store, cfg, {
    now: new Date(now.getTime() + 60000),
    openSession: async () => ({
      async call(tool) {
        return tool.endsWith("slack_read_thread")
          ? {
              messages:
                "From: Person\nTime: today\nMessage TS: 1700000000.000001\nTruncated",
              pagination_info: "More messages may exist",
            }
          : { results: "## Messages (0 results)", pagination_info: "" };
      },
      async close() {},
    }),
  });
  expect(store.records("slack")[0]!.data).toEqual({ ...thread });
  expect(store.health("slack").succeededAt).toBe(now.toISOString());
  expect(store.health("slack").gap).toContain("coverage incomplete");
  expect(store.health("slack").gap).toContain("4 pages of 100");
  store.close();
});

test("should retain pasted email headers and later replies while rejecting an invalid root header", async () => {
  const { parseSlackThread, readFollowedThread } =
    await import("../scripts/lib/work/slack.ts");
  const messages =
    "From: Person\nTime: today\nMessage TS: 1700000000.000001\nRoot\nFrom: email@example.com\nTime: yesterday\nSubject: pasted email\nFrom: Other\nTime: later\nMessage TS: 1700000010.000001\nLater reply";
  const raw = {
    messages,
    pagination_info: "There are no more messages in this thread.",
  };
  const parsed = parseSlackThread(raw, "C123", "1700000000.000001");
  expect(parsed.timestamps).toEqual(["1700000000.000001", "1700000010.000001"]);
  expect(parsed.text).toContain("Later reply");

  const session = { call: async () => raw, close: async () => {} };
  expect(
    (await readFollowedThread(session, cfg.slack!, "C123", "1700000000.000001"))
      .complete,
  ).toBe(true);
  const invalid = {
    ...raw,
    messages: messages.replace(
      "Message TS: 1700000000.000001",
      "Message TS: invalid",
    ),
  };
  expect(() =>
    parseSlackThread(invalid, "C123", "1700000000.000001"),
  ).toThrow();
  await expect(
    readFollowedThread(
      {
        ...session,
        call: async () => ({
          ...raw,
          messages: messages.replace("1700000000.000001", "1700000099.000001"),
        }),
      },
      cfg.slack!,
      "C123",
      "1700000000.000001",
    ),
  ).rejects.toThrow();
});
