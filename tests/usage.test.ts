import { afterAll, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ingest, openUsageDb } from "../scripts/lib/usage/ingest.ts";
import { insights } from "../scripts/lib/usage/insights.ts";
import { credentialsToken, limitsView, parseLimits, pollLimits } from "../scripts/lib/usage/limits.ts";
import { cachedShare, tokenCount } from "../scripts/lib/usage/format.ts";
import { baseModel, costUsd } from "../scripts/lib/usage/pricing.ts";
import { sessionDetail, sessions, timeline } from "../scripts/lib/usage/query.ts";
import { createServer, parseRange } from "../scripts/lib/usage/server.ts";

const root = mkdtempSync(resolve(tmpdir(), "slopestyle-usage-test."));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const host = "testhost";
const project = "-home-kris-dev-app";
const sessionId = "11111111-2222-3333-4444-555555555555";
const agentId = "abcdef0123456789a";
const t0 = Date.parse("2026-09-02T08:00:00.000Z");

interface RequestSpec {
  minutes: number;
  model?: string;
  input?: number;
  cache5m?: number;
  cache1h?: number;
  cacheRead?: number;
  output?: number;
  requestId?: string;
}

function assistantLine(spec: RequestSpec, extra: Record<string, unknown> = {}): string {
  const { minutes, model = "claude-opus-5", input = 10, cache5m = 0, cache1h = 0, cacheRead = 0, output = 100 } = spec;
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(t0 + minutes * 60_000).toISOString(),
    requestId: spec.requestId ?? `req_${minutes}`,
    sessionId,
    cwd: "/home/kris/dev/app",
    gitBranch: "main",
    version: "2.1.258",
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cache5m + cache1h,
        cache_creation: { ephemeral_5m_input_tokens: cache5m, ephemeral_1h_input_tokens: cache1h },
        output_tokens_details: { thinking_tokens: 5 },
      },
    },
    ...extra,
  });
}

function userLine(text: string, minutes: number): string {
  return JSON.stringify({ type: "user", timestamp: new Date(t0 + minutes * 60_000).toISOString(), sessionId, message: { role: "user", content: text } });
}

function agentCallLine(minutes: number, prompt: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(t0 + minutes * 60_000).toISOString(),
    requestId: `req_agentcall_${minutes}`,
    sessionId,
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: { description: "Explore prior art", subagent_type: "Explore", model: "sonnet", prompt } }],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}

function compactLine(minutes: number): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    timestamp: new Date(t0 + minutes * 60_000).toISOString(),
    sessionId,
    compactMetadata: { trigger: "auto", preTokens: 170000, postTokens: 8000 },
  });
}

function writeFixture(dir: string): { sessionFile: string; agentFile: string } {
  const projectDir = resolve(dir, project);
  mkdirSync(resolve(projectDir, sessionId, "subagents"), { recursive: true });
  const sessionFile = resolve(projectDir, `${sessionId}.jsonl`);
  const agentPrompt = "Survey the routes directory and report conventions.";
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "Labels feature build", sessionId }),
      userLine("Build the labels feature", 0),
      assistantLine({ minutes: 1, input: 1000, output: 200 }),
      // A streamed request repeats its requestId across records.
      assistantLine({ minutes: 2, input: 500, cacheRead: 100_000, output: 300, requestId: "req_streamed" }),
      assistantLine({ minutes: 2, input: 500, cacheRead: 100_000, output: 999, requestId: "req_streamed" }),
      // Lines that are not objects are skipped, not fatal.
      "null",
      '"just a string"',
      agentCallLine(3, agentPrompt),
      compactLine(70),
      assistantLine({ minutes: 75, model: "claude-fable-5-1", input: 0, cache1h: 20_000, cacheRead: 150_000, output: 1000 }),
      assistantLine({ minutes: 80, model: "claude-mystery-9", input: 100, output: 100 }),
    ].join("\n") + "\n",
  );
  const agentFile = resolve(projectDir, sessionId, "subagents", `agent-${agentId}.jsonl`);
  writeFileSync(
    agentFile,
    [
      JSON.stringify({ type: "user", timestamp: new Date(t0 + 3 * 60_000).toISOString(), sessionId, agentId, isSidechain: true, message: { role: "user", content: agentPrompt } }),
      assistantLine({ minutes: 4, model: "claude-sonnet-5", input: 2000, output: 500 }, { agentId, requestId: "req_agent_1" }),
      assistantLine({ minutes: 5, model: "claude-sonnet-5", input: 0, cacheRead: 30_000, output: 500 }, { agentId, requestId: "req_agent_2" }),
    ].join("\n") + "\n",
  );
  // A second session with no ai-title: its first user records are a skill
  // load (meta) and a channel-relayed prompt, so the title comes from the
  // channel body.
  const channelSessionId = "22222222-2222-3333-4444-555555555555";
  writeFileSync(
    resolve(projectDir, `${channelSessionId}.jsonl`),
    [
      JSON.stringify({ type: "user", isMeta: true, timestamp: new Date(t0 + 30 * 60_000).toISOString(), sessionId: channelSessionId, message: { role: "user", content: "Base directory for this skill: /home/kris/.claude/skills/unslop" } }),
      JSON.stringify({
        type: "user",
        isMeta: true,
        timestamp: new Date(t0 + 31 * 60_000).toISOString(),
        sessionId: channelSessionId,
        message: { role: "user", content: [{ type: "text", text: '<channel source="threa-channel" invocation_id="binv_1">\nPlease pull main and check CI.\n\nEarlier in this scratchpad (oldest first, for context):\n- Kris: hello\n</channel>' }] },
      }),
      assistantLine({ minutes: 32, input: 10, output: 10 }).replace(sessionId, channelSessionId),
    ].join("\n") + "\n",
  );
  return { sessionFile, agentFile };
}

const projectsDir = resolve(root, "projects");
const fixture = writeFixture(projectsDir);
const db = openUsageDb(resolve(root, "usage.sqlite"));
const day = { fromMs: t0 - 8 * 3_600_000, toMs: t0 + 16 * 3_600_000 };

test("should price a request from its usage when the model is known", () => {
  expect(costUsd("claude-opus-5[1m]", { input: 1_000_000, cache5m: 0, cache1h: 0, cacheRead: 0, output: 0 })).toBe(5);
  expect(costUsd("claude-haiku-4-5-20251001", { input: 0, cache5m: 0, cache1h: 0, cacheRead: 1_000_000, output: 0 })).toBe(0.1);
  expect(costUsd("claude-mystery-9", { input: 1, cache5m: 0, cache1h: 0, cacheRead: 0, output: 0 })).toBeUndefined();
  expect(baseModel("claude-fable-5-1[1m]")).toBe("claude-fable-5-1");
});

test("should count a streamed request once when assistant records repeat the requestId", () => {
  const stats = ingest(db, { projectsDir, host });
  expect(stats).toEqual({ filesScanned: 3, filesChanged: 3, requestsAdded: 8, failed: [] });
  expect(db.query<{ output: number }, [string]>("SELECT output FROM requests WHERE request_id = ?").get("req_streamed")).toEqual({ output: 300 });
  const [summary, channelSession] = sessions(db, day);
  expect(channelSession).toMatchObject({ id: "22222222-2222-3333-4444-555555555555", title: "Please pull main and check CI.", requests: 1 });
  expect(summary).toMatchObject({
    id: sessionId,
    title: "Labels feature build",
    project,
    cwd: "/home/kris/dev/app",
    git_branch: "main",
    requests: 7,
    requests_sub: 2,
    // Every token read, main thread and subagents, with the streamed request counted once.
    input_tokens: 1000 + 100_500 + 1 + 170_000 + 100 + 2000 + 30_000,
    cache_read_tokens: 100_000 + 150_000 + 30_000,
    output_tokens: 200 + 300 + 1 + 1000 + 100 + 500 + 500,
    peak_context: 170_000,
    agents: 1,
    compactions: 1,
    models: { "claude-opus-5": 3, "claude-fable-5-1": 1, "claude-mystery-9": 1, "claude-sonnet-5": 2 },
  });
});

test("should roll subagent cost into the parent session in the timeline", () => {
  const view = timeline(db, day, "hour", 0);
  expect(view.buckets).toHaveLength(24);
  expect(view.series).toHaveLength(2);
  const values = view.series[0]!.values;
  const firstHour = values[8]!;
  const secondHour = values[9]!;
  // Hour one: two main requests plus both subagent requests.
  const main1 = costUsd("claude-opus-5", { input: 1000, cache5m: 0, cache1h: 0, cacheRead: 0, output: 200 })!;
  const main2 = costUsd("claude-opus-5", { input: 500, cache5m: 0, cache1h: 0, cacheRead: 100_000, output: 300 })!;
  const call = costUsd("claude-opus-5", { input: 1, cache5m: 0, cache1h: 0, cacheRead: 0, output: 1 })!;
  const sub1 = costUsd("claude-sonnet-5", { input: 2000, cache5m: 0, cache1h: 0, cacheRead: 0, output: 500 })!;
  const sub2 = costUsd("claude-sonnet-5", { input: 0, cache5m: 0, cache1h: 0, cacheRead: 30_000, output: 500 })!;
  expect(firstHour).toBeCloseTo(main1 + main2 + call + sub1 + sub2, 9);
  expect(secondHour).toBeCloseTo(costUsd("claude-fable-5-1", { input: 0, cache5m: 0, cache1h: 20_000, cacheRead: 150_000, output: 1000 })!, 9);
  expect(view.total_usd).toBeCloseTo(firstHour + secondHour + view.series[1]!.values[8]!, 9);
  expect(view.total_input_tokens).toBe(303_611);
  expect(view.total_output_tokens).toBe(2611);
  expect(view.unpriced_models).toEqual(["claude-mystery-9"]);
  const [summary] = sessions(db, day);
  expect(summary!.cost_sub_usd).toBeCloseTo(sub1 + sub2, 9);
});

test("should link a subagent to the Agent call that spawned it", () => {
  const detail = sessionDetail(db, sessionId, day)!;
  expect(detail.agents).toHaveLength(1);
  expect(detail.agents[0]).toMatchObject({ id: agentId, subagent_type: "Explore", model_requested: "sonnet", description: "Explore prior art", requests: 2, input_tokens: 32_000, cache_read_tokens: 30_000, output_tokens: 1000, peak_context: 30_000 });
  expect(detail.events.map((event) => event.kind)).toEqual(["agent_call", "compact"]);
  expect(detail.events[1]!.data).toEqual({ trigger: "auto", preTokens: 170000, postTokens: 8000 });
  expect(detail.requests.map((request) => request.context)).toEqual([1000, 100_500, 1, 2000, 30_000, 170_000, 100]);
});

test("should ingest only appended lines when a file grows", () => {
  appendFileSync(fixture.sessionFile, assistantLine({ minutes: 90, input: 10, output: 10 }) + "\n");
  expect(ingest(db, { projectsDir, host })).toEqual({ filesScanned: 3, filesChanged: 1, requestsAdded: 1, failed: [] });
  expect(sessions(db, day)[0]!.requests).toBe(8);
  expect(ingest(db, { projectsDir, host })).toEqual({ filesScanned: 3, filesChanged: 0, requestsAdded: 0, failed: [] });
});

test("should keep a partial trailing line for the next pass when a file grows", () => {
  const line = assistantLine({ minutes: 95, input: 10, output: 10 });
  appendFileSync(fixture.sessionFile, line.slice(0, 40));
  expect(ingest(db, { projectsDir, host }).requestsAdded).toBe(0);
  appendFileSync(fixture.sessionFile, line.slice(40) + "\n");
  expect(ingest(db, { projectsDir, host }).requestsAdded).toBe(1);
  expect(sessions(db, day)[0]!.requests).toBe(9);
});

test("should reingest a file when it shrinks", () => {
  writeFileSync(fixture.agentFile, assistantLine({ minutes: 4, model: "claude-sonnet-5", input: 1, output: 1 }, { agentId, requestId: "req_agent_only" }) + "\n");
  expect(ingest(db, { projectsDir, host })).toEqual({ filesScanned: 3, filesChanged: 1, requestsAdded: 1, failed: [] });
  expect(sessions(db, day)[0]!.requests_sub).toBe(1);
});

test("should default the range to the local day in the caller's timezone", () => {
  const now = Date.parse("2026-09-02T01:30:00.000Z");
  const utc = parseRange(new URLSearchParams(), now);
  expect(utc.range).toEqual({ fromMs: Date.parse("2026-09-02T00:00:00.000Z"), toMs: Date.parse("2026-09-03T00:00:00.000Z") });
  // UTC+2: 01:30Z is 03:30 local, so the local day started at 22:00Z the day before.
  const cest = parseRange(new URLSearchParams({ tz: "120" }), now);
  expect(cest.range).toEqual({ fromMs: Date.parse("2026-09-01T22:00:00.000Z"), toMs: Date.parse("2026-09-02T22:00:00.000Z") });
  expect(cest.offsetMinutes).toBe(120);
  // A bare date is that local day too.
  expect(parseRange(new URLSearchParams({ tz: "120", from: "2026-09-01", to: "2026-09-02" })).range).toEqual({ fromMs: Date.parse("2026-08-31T22:00:00.000Z"), toMs: Date.parse("2026-09-01T22:00:00.000Z") });
  expect(() => parseRange(new URLSearchParams({ from: "2026-09-02", to: "2026-09-01" }))).toThrow("to must be after from");
});

test("should skip an unreadable transcript and keep ingesting the others", () => {
  if (process.getuid?.() === 0) return;
  const dir = resolve(root, "projects-unreadable");
  const other = openUsageDb(resolve(root, "usage-unreadable.sqlite"));
  mkdirSync(resolve(dir, project), { recursive: true });
  const locked = resolve(dir, project, "aaaaaaaa-0000-0000-0000-000000000000.jsonl");
  writeFileSync(locked, `${userLine("secret", 0)}\n`);
  writeFileSync(resolve(dir, project, "bbbbbbbb-0000-0000-0000-000000000000.jsonl"), `${userLine("readable", 0)}\n${assistantLine({ minutes: 1, input: 10, output: 10 })}\n`);
  chmodSync(locked, 0o000);
  try {
    const stats = ingest(other, { projectsDir: dir, host });
    expect(stats.requestsAdded).toBe(1);
    expect(stats.failed).toHaveLength(1);
    expect(stats.failed[0]!.path).toBe(locked);
    // The failure is remembered, so the next pass does not retry an unchanged file.
    expect(ingest(other, { projectsDir: dir, host }).failed).toEqual([]);
  } finally {
    chmodSync(locked, 0o644);
    other.close();
  }
});

test("should serve sessions and a session detail over HTTP", async () => {
  const server = createServer({ db, ingest: { projectsDir, host }, port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const query = `from=${day.fromMs}&to=${day.toMs}`;
    const list = (await (await fetch(`${base}/api/sessions?${query}`)).json()) as { id: string }[];
    expect(list.map((row) => row.id)).toEqual([sessionId, "22222222-2222-3333-4444-555555555555"]);
    const detail = (await (await fetch(`${base}/api/sessions/${sessionId}?${query}`)).json()) as { session: { id: string }; agents: unknown[] };
    expect(detail.session.id).toBe(sessionId);
    expect(detail.agents).toHaveLength(1);
    const line = (await (await fetch(`${base}/api/timeline?${query}&bucket=hour`)).json()) as { buckets: number[] };
    expect(line.buckets).toHaveLength(24);
    expect((await fetch(`${base}/api/sessions/nope?${query}`)).status).toBe(404);
    expect((await fetch(`${base}/api/timeline?bucket=week`)).status).toBe(400);
    expect((await fetch(`${base}/api/refresh`)).status).toBe(405);
    const refreshed = (await (await fetch(`${base}/api/refresh`, { method: "POST" })).json()) as { filesScanned: number };
    expect(refreshed.filesScanned).toBe(3);
  } finally {
    server.stop(true);
  }
});

const usagePayload = {
  five_hour: { utilization: 36, resets_at: "2026-09-02T14:00:00.377944+00:00" },
  seven_day: { utilization: 14, resets_at: "2026-09-06T00:00:00.377969+00:00" },
  limits: [
    { kind: "session", group: "session", percent: 36, resets_at: "2026-09-02T14:00:00.377944+00:00", scope: null },
    { kind: "weekly_all", group: "weekly", percent: 14, resets_at: "2026-09-06T00:00:00.377969+00:00", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 20, resets_at: "2026-09-06T00:00:00.378211+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
};

test("should turn the usage payload into one sample per limit with resets on the minute", () => {
  expect(parseLimits(usagePayload)).toEqual([
    { kind: "five_hour", label: "5-hour", percent: 36, resets_ms: Date.parse("2026-09-02T14:00:00Z") },
    { kind: "seven_day", label: "Weekly", percent: 14, resets_ms: Date.parse("2026-09-06T00:00:00Z") },
    { kind: "seven_day_fable", label: "Weekly Fable", percent: 20, resets_ms: Date.parse("2026-09-06T00:00:00Z") },
  ]);
  expect(parseLimits({ five_hour: { utilization: 1, resets_at: "2026-09-02T13:59:59.604Z" } })[0]!.resets_ms).toBe(Date.parse("2026-09-02T14:00:00Z"));
  expect(parseLimits({ five_hour: null, seven_day: { utilization: null, resets_at: null } })).toEqual([]);
});

test("should store limit samples and derive windows with their spend", async () => {
  const polledAt = Date.parse("2026-09-02T11:30:00.000Z");
  const status = await pollLimits(db, () => ({ accessToken: "token" }), async () => usagePayload, polledAt);
  expect(status).toEqual({ polled_ms: polledAt, ok: true });
  const view = limitsView(db, t0 - 8 * 3_600_000, t0 + 16 * 3_600_000, polledAt);
  expect(view.latest.map((sample) => [sample.kind, sample.percent])).toEqual([
    ["five_hour", 36],
    ["seven_day", 14],
    ["seven_day_fable", 20],
  ]);
  expect(view.windows.find((window) => window.kind === "five_hour")).toEqual({
    kind: "five_hour",
    label: "5-hour",
    start_ms: Date.parse("2026-09-02T09:00:00Z"),
    end_ms: Date.parse("2026-09-02T14:00:00Z"),
    current: true,
  });
  expect(view.windows.filter((window) => window.kind !== "five_hour").map((window) => window.label)).toEqual(["Weekly", "Weekly Fable"]);
  // A later poll with a jittered resets_at must not open a second window.
  await pollLimits(db, () => ({ accessToken: "token" }), async () => ({ five_hour: { utilization: 40, resets_at: "2026-09-02T13:59:59.604+00:00" } }), polledAt + 120_000);
  const again = limitsView(db, t0 - 8 * 3_600_000, t0 + 16 * 3_600_000, polledAt + 120_000);
  expect(again.windows.filter((window) => window.kind === "five_hour")).toHaveLength(1);
  expect(again.samples.filter((sample) => sample.kind === "five_hour")).toHaveLength(2);
});

test("should report a missing or expired token instead of polling", async () => {
  const missing = await pollLimits(db, () => ({ error: "No credentials" }), async () => usagePayload, 1);
  expect(missing).toEqual({ polled_ms: 1, ok: false, error: "No credentials" });
  const expired = await pollLimits(db, () => ({ accessToken: "t", expiresAt: 5 }), async () => usagePayload, 10);
  expect(expired.ok).toBe(false);
  expect(expired.error).toContain("expired");
  expect(credentialsToken(resolve(root, "nowhere"), "linux")).toEqual({ error: `No Claude Code credentials at ${resolve(root, "nowhere/.claude/.credentials.json")}` });
});

test("should serve limits with window spend over HTTP", async () => {
  const server = createServer({ db, ingest: { projectsDir, host }, port: 0, tokenSource: () => ({ accessToken: "token" }), fetcher: async () => usagePayload, pollIntervalMs: 60_000 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const body = (await (await fetch(`${base}/api/limits?from=${day.fromMs}&to=${day.toMs}`)).json()) as { polling: boolean; windows: { kind: string; spend_usd: number }[]; latest: unknown[] };
    expect(body.polling).toBe(true);
    expect(body.latest).toHaveLength(3);
    const window = body.windows.find((entry) => entry.kind === "five_hour")!;
    // The 5-hour window 09:00-14:00Z covers the fixture's 09:15 and 09:20 requests.
    expect(window.spend_usd).toBeCloseTo(costUsd("claude-fable-5-1", { input: 0, cache5m: 0, cache1h: 20_000, cacheRead: 150_000, output: 1000 })! + costUsd("claude-opus-5", { input: 10, cache5m: 0, cache1h: 0, cacheRead: 0, output: 10 })! * 2, 9);
  } finally {
    server.stop(true);
  }
});

test("should explain the range with insights that name the numbers", () => {
  const view = insights(db, day, Date.parse("2026-09-02T11:30:00.000Z"));
  const kinds = view.insights.map((insight) => insight.kind);
  expect(kinds).toContain("top_session");
  expect(kinds).toContain("large_context");
  expect(kinds).toContain("model_mix");
  expect(kinds).toContain("window_rate");
  const top = view.insights.find((insight) => insight.kind === "top_session")!;
  expect(top.data.session_id).toBe(sessionId);
  expect(top.text).toContain("Labels feature build");
  const rate = view.insights.find((insight) => insight.kind === "window_rate")!;
  expect(rate.data.percent).toBe(36);
  expect(rate.text).toContain("14:00 UTC");
  expect(insights(db, { fromMs: 0, toMs: 1 })).toEqual({ total_usd: 0, insights: [] });
});

test("should format token counts and cache shares for people", () => {
  expect([850, 1499, 1500, 999_499, 999_500, 1_234_567, 9_950_000, 34_000_000].map(tokenCount)).toEqual(["850", "1k", "2k", "999k", "1.0M", "1.2M", "10M", "34M"]);
  expect(cachedShare(303_611, 280_000)).toBe("92% cached");
  expect(cachedShare(0, 0)).toBe("");
});

test("should print a report for a range from the CLI", async () => {
  const cli = resolve(import.meta.dir, "../scripts/usage.ts");
  const args = ["report", "--projects", projectsDir, "--db", resolve(root, "usage.sqlite"), "--host", host, "--from", String(day.fromMs), "--to", String(day.toMs)];
  const text = Bun.spawnSync([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(text.exitCode).toBe(0);
  const out = text.stdout.toString();
  expect(out).toContain("Labels feature build");
  // Earlier tests shrank the subagent transcript, so this is the range as it stands now.
  expect(out).toContain("272k in and 2k out");
  expect(out).toContain("272k in     2k out  peak  170k");
  expect(out).toContain("5-hour: 36%");
  const json = Bun.spawnSync([process.execPath, cli, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(json.exitCode).toBe(0);
  const parsed = JSON.parse(json.stdout.toString()) as { pricing: string; sessions: { id: string }[]; insights: unknown[]; limits: { latest: unknown[] } };
  expect(parsed.pricing).toBe("API list prices");
  expect(parsed.sessions[0]!.id).toBe(sessionId);
  expect(parsed.limits.latest).toHaveLength(3);
  expect(parsed.insights.length).toBeGreaterThan(0);
});
