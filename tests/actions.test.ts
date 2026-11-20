import { expect, test } from "bun:test";
import { parseActionsConfig } from "../scripts/lib/actions/config.ts";
import { createGithubClient, GithubError, type Job, type WorkflowRun } from "../scripts/lib/actions/github.ts";
import { createActionsServer, createPoller } from "../scripts/lib/actions/server.ts";
import { buildSnapshot } from "../scripts/lib/actions/view.ts";

function run(id: number, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    run_number: id - 1000,
    run_attempt: 1,
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    head_sha: `sha${id}`,
    display_title: `Run ${id}`,
    html_url: `https://github.com/example/app/actions/runs/${id}`,
    created_at: `2026-09-02T08:${String(id % 60).padStart(2, "0")}:00Z`,
    run_started_at: null,
    updated_at: "2026-09-02T09:00:00Z",
    actor: { login: "octocat" },
    ...overrides,
  };
}

function job(id: number, name: string, overrides: Partial<Job> = {}): Job {
  return { id, name, status: "completed", conclusion: "success", started_at: "2026-09-02T08:00:00Z", completed_at: "2026-09-02T08:05:00Z", html_url: `https://github.com/example/app/job/${id}`, ...overrides };
}

const config = { repo: "example/app", pipelines: [{ name: "Dev", workflow: "deploy.yaml" }] };

test("should group, roll up, order and link runs when building a snapshot", () => {
  const dev = [
    run(1001, { head_sha: "shared" }),
    run(1002, { status: "in_progress", conclusion: null, created_at: "2026-09-02T07:00:00Z", run_started_at: "2026-09-02T07:01:00Z" }),
    run(1003, { conclusion: "failure", created_at: "2026-09-02T10:00:00Z" }),
  ];
  const prod = [run(2001, { head_sha: "shared", run_number: 7 }), run(2002)];
  const jobs = new Map<number, Job[]>([
    [
      1003,
      [
        job(1, "Build / Docker / api"),
        job(2, "Build / Docker / web", { conclusion: "failure" }),
        job(3, "Lint"),
        job(4, "Notify / slack", { conclusion: "skipped" }),
        job(5, "Notify / email", { conclusion: "skipped" }),
        job(6, "Release", { conclusion: "cancelled" }),
        job(9, "Test (linux / arm64)"),
      ],
    ],
    [1002, [job(7, "Build / api", { status: "in_progress", conclusion: null, completed_at: null }), job(8, "Build / web", { conclusion: "failure" })]],
  ]);
  const snapshot = buildSnapshot({
    repo: "example/app",
    pipelines: [
      { name: "Dev", workflow: "deploy.yaml", runs: dev },
      { name: "Prod", workflow: "promote.yaml", runs: prod },
    ],
    jobs,
  });
  const lane = snapshot.pipelines[0]!;
  expect(lane.url).toBe("https://github.com/example/app/actions/workflows/deploy.yaml");
  expect(lane.runs.map((entry) => entry.id)).toEqual([1002, 1003, 1001]);

  const failed = lane.runs[1]!;
  expect(failed.state).toBe("failure");
  expect(failed.groups.map((group) => [group.name, group.state, group.jobs.length])).toEqual([
    ["Build", "failure", 2],
    ["Lint", "success", 1],
    ["Notify", "skipped", 2],
    ["Release", "cancelled", 1],
    ["Test (linux / arm64)", "success", 1],
  ]);
  expect(failed.groups[0]!.jobs[0]!.name).toBe("Docker / api");
  expect(failed.groups[1]!.jobs[0]!.name).toBe("Lint");
  expect(failed.failedJobs).toEqual([{ name: "Build / Docker / web", url: "https://github.com/example/app/job/2" }]);

  const running = lane.runs[0]!;
  expect(running.startedAt).toBe("2026-09-02T07:01:00Z");
  expect(running.state).toBe("failing");
  expect(running.groups[0]).toMatchObject({ name: "Build", state: "failing", completedAt: null });
  expect(running.groups[0]!.jobs.map((entry) => [entry.name, entry.state])).toEqual([
    ["api", "running"],
    ["web", "failure"],
  ]);

  expect(lane.runs[2]!.sameCommit).toEqual([{ pipeline: "Prod", id: 2001, number: 7, url: "https://github.com/example/app/actions/runs/2001" }]);
  expect(lane.runs[0]!.sameCommit).toEqual([]);
});

function stubFetch(responses: (url: string, headers: Headers) => Response) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    return responses(url, headers);
  }) as typeof fetch;
  return { fetcher, calls };
}

test("should replay the cached body when GitHub answers 304 to a conditional request", async () => {
  const { fetcher, calls } = stubFetch((_url, headers) => (headers.get("if-none-match") === '"v1"' ? new Response(null, { status: 304 }) : Response.json({ hello: "world" }, { headers: { etag: '"v1"' } })));
  const client = createGithubClient({ token: "t", fetch: fetcher });
  expect(await client.getJson<{ hello: string }>("https://api.example/x")).toEqual({ hello: "world" });
  expect(await client.getJson<{ hello: string }>("https://api.example/x")).toEqual({ hello: "world" });
  expect(calls.map((call) => call.headers.get("if-none-match"))).toEqual([null, '"v1"']);
  expect(calls[0]!.headers.get("authorization")).toBe("Bearer t");
});

test("should follow Link next pages and surface GitHub errors", async () => {
  const { fetcher } = stubFetch((url) => {
    if (url.endsWith("/limited")) return Response.json({ message: "API rate limit exceeded" }, { status: 403 });
    if (url.endsWith("?page=2")) return Response.json({ jobs: [2] });
    return Response.json({ jobs: [1] }, { headers: { link: '<https://api.example/jobs?page=2>; rel="next", <https://api.example/jobs?page=2>; rel="last"' } });
  });
  const client = createGithubClient({ token: "t", fetch: fetcher });
  expect(await client.getAll("https://api.example/jobs", (body: { jobs: number[] }) => body.jobs)).toEqual([1, 2]);
  const error = await client.getJson("https://api.example/limited").then(() => undefined, (caught: GithubError) => caught);
  expect(error).toBeInstanceOf(GithubError);
  expect(error?.status).toBe(403);
  expect(error?.message).toContain("rate limit");
});

test("should retry once when GitHub answers 5xx or drops the connection", async () => {
  let attempts = 0;
  const { fetcher } = stubFetch((url) => {
    attempts += 1;
    if (url.endsWith("/dropped") && attempts === 1) throw new TypeError("connection reset");
    if (url.endsWith("/flaky") && attempts === 3) return new Response("Server Error", { status: 502 });
    if (url.endsWith("/down")) return new Response("Server Error", { status: 503 });
    return Response.json({ ok: true });
  });
  const client = createGithubClient({ token: "t", fetch: fetcher, retryDelayMs: 0 });
  expect(await client.getJson<{ ok: boolean }>("https://api.example/dropped")).toEqual({ ok: true });
  expect(await client.getJson<{ ok: boolean }>("https://api.example/flaky")).toEqual({ ok: true });
  const error = await client.getJson("https://api.example/down").then(() => undefined, (caught: GithubError) => caught);
  expect({ status: error?.status, attempts }).toEqual({ status: 503, attempts: 6 });
});

test("should fail a request instead of waiting forever when GitHub stops answering", async () => {
  const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  const client = createGithubClient({ token: "t", fetch: hanging, retryDelayMs: 0, timeoutMs: 20 });
  await expect(client.getJson("https://api.example/stalled")).rejects.toThrow();
});

function githubFake() {
  let failing = false;
  const requests: string[] = [];
  const { fetcher } = stubFetch((url) => {
    requests.push(url);
    if (failing) return Response.json({ message: "Bad gateway" }, { status: 502 });
    if (url.includes("/workflows/deploy.yaml/runs")) return Response.json({ workflow_runs: [run(1001), run(1002, { status: "in_progress", conclusion: null })] });
    return Response.json({ jobs: [job(1, "Build / api")] });
  });
  return { fetcher, requests, fail: (value: boolean) => (failing = value) };
}

test("should poll GitHub only when a page asks for stale data and refetch jobs only for active runs", async () => {
  const fake = githubFake();
  const server = createActionsServer({ config, client: createGithubClient({ token: "t", fetch: fake.fetcher, retryDelayMs: 0 }), port: 0, pollIntervalMs: 3_600_000 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    await Bun.sleep(20);
    expect(fake.requests).toHaveLength(0);
    expect((await (await fetch(`${base}/api/snapshot`)).json()).loading).toBe(true);
    const refreshed = await (await fetch(`${base}/api/refresh`, { method: "POST" })).json();
    expect(refreshed.error).toBeNull();
    expect(refreshed.pipelines[0].runs.map((entry: { id: number }) => entry.id)).toEqual([1002, 1001]);
    expect(refreshed.pipelines[0].runs[0].groups[0].name).toBe("Build");
    const polled = fake.requests.length;
    await fetch(`${base}/api/snapshot`);
    await Bun.sleep(20);
    expect(fake.requests).toHaveLength(polled);
    const jobRequests = (id: number) => fake.requests.filter((url) => url.includes(`/runs/${id}/jobs`)).length;
    const before = [jobRequests(1001), jobRequests(1002)];
    await fetch(`${base}/api/refresh`, { method: "POST" });
    expect([jobRequests(1001) - before[0]!, jobRequests(1002) - before[1]!]).toEqual([0, 1]);
    expect((await fetch(`${base}/api/refresh`)).status).toBe(405);
  } finally {
    server.stop(true);
  }
});

test("should keep the previous snapshot and report the error when a poll fails", async () => {
  const fake = githubFake();
  const server = createActionsServer({ config, client: createGithubClient({ token: "t", fetch: fake.fetcher, retryDelayMs: 0 }), port: 0, pollIntervalMs: 3_600_000 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    await fetch(`${base}/api/refresh`, { method: "POST" });
    fake.fail(true);
    const failed = await (await fetch(`${base}/api/refresh`, { method: "POST" })).json();
    expect(failed.pipelines[0].runs).toHaveLength(2);
    expect(failed.error.message).toStartWith("Dev (deploy.yaml): GitHub 502");
    expect((await fetch(`${base}/api/snapshot`, { headers: { host: "rebound.example" } })).status).toBe(403);
    fake.fail(false);
    expect((await (await fetch(`${base}/api/refresh`, { method: "POST" })).json()).error).toBeNull();
  } finally {
    server.stop(true);
  }
});

test("should accept a valid config and reject unknown fields, bad repos and duplicate names", () => {
  expect(parseActionsConfig({ repo: "example/app", pipelines: [{ name: "Dev", workflow: "deploy.yaml" }, { name: "Prod", workflow: "123" }] }).pipelines).toHaveLength(2);
  expect(() => parseActionsConfig({ repo: "example/app", pipelines: [{ name: "Dev", workflow: "deploy.yaml" }], extra: 1 })).toThrow("Unknown config field");
  expect(() => parseActionsConfig({ repo: "example", pipelines: [{ name: "Dev", workflow: "deploy.yaml" }] })).toThrow("owner/name");
  expect(() => parseActionsConfig({ repo: "example/app", pipelines: [{ name: "Dev", workflow: "a.yaml" }, { name: "Dev", workflow: "b.yaml" }] })).toThrow("Duplicate");
  expect(() => parseActionsConfig({ repo: "example/app", pipelines: [{ name: "Dev", workflow: "deploy.sh" }] })).toThrow("workflow");
  expect(() => parseActionsConfig({ repo: "example/app", pipelines: [] })).toThrow("non-empty");
});

test("should refetch jobs for a run that reappears after dropping out of the listing when polling", async () => {
  let listed = [run(1001)];
  const requests: string[] = [];
  const { fetcher } = stubFetch((url) => {
    requests.push(url);
    return url.includes("/runs?") ? Response.json({ workflow_runs: listed }) : Response.json({ jobs: [job(1, "Build / api")] });
  });
  const poll = createPoller(config, createGithubClient({ token: "t", fetch: fetcher }));
  const jobRequests = () => requests.filter((url) => url.includes("/runs/1001/jobs")).length;
  await poll();
  await poll();
  expect(jobRequests()).toBe(1);
  listed = [];
  await poll();
  listed = [run(1001)];
  await poll();
  expect(jobRequests()).toBe(2);
});

test("should list jobs for active runs and backfill finished runs newest first when polling", async () => {
  const requests: string[] = [];
  const listed = [
    run(1001, { created_at: "2026-09-02T08:00:00Z" }),
    run(1002, { created_at: "2026-09-02T09:00:00Z" }),
    run(1003, { status: "in_progress", conclusion: null, created_at: "2026-09-02T07:00:00Z" }),
  ];
  const { fetcher } = stubFetch((url) => {
    requests.push(url);
    return url.includes("/runs?") ? Response.json({ workflow_runs: url.includes("deploy.yaml") ? listed : [] }) : Response.json({ jobs: [job(1, "Build")] });
  });
  const poll = createPoller(config, createGithubClient({ token: "t", fetch: fetcher }), 1);
  const jobRuns = () => requests.flatMap((url) => url.match(/runs\/(\d+)\/jobs/)?.[1] ?? []);
  const first = await poll();
  expect(jobRuns()).toEqual(["1003", "1002"]);
  expect(first.pipelines[0]!.runs.map((entry) => [entry.id, entry.groups.length])).toEqual([[1003, 1], [1002, 1], [1001, 0]]);
  await poll();
  expect(jobRuns()).toEqual(["1003", "1002", "1003", "1001"]);
});

test("should keep a run's last jobs and report why when listing them fails", async () => {
  let broken = false;
  const active = run(1001, { status: "in_progress", conclusion: null });
  const { fetcher } = stubFetch((url) => {
    if (url.includes("/runs?")) return Response.json({ workflow_runs: url.includes("deploy.yaml") ? [active] : [] });
    return broken ? new Response("Server Error", { status: 502 }) : Response.json({ jobs: [job(1, "Build / api")] });
  });
  const poll = createPoller(config, createGithubClient({ token: "t", fetch: fetcher, retryDelayMs: 0 }));
  expect((await poll()).pipelines[0]!.runs[0]!.jobsError).toBeNull();
  broken = true;
  const failed = (await poll()).pipelines[0]!.runs[0]!;
  expect({ jobsError: failed.jobsError, groups: failed.groups.map((group) => group.name) }).toEqual({ jobsError: "GitHub 502", groups: ["Build"] });
});

test("should not link runs that share a commit when they belong to the same pipeline", () => {
  const snapshot = buildSnapshot({ repo: "example/app", pipelines: [{ name: "Dev", workflow: "deploy.yaml", runs: [run(1001, { head_sha: "same" }), run(1002, { head_sha: "same" })] }], jobs: new Map() });
  expect(snapshot.pipelines[0]!.runs.map((entry) => entry.sameCommit)).toEqual([[], []]);
});
