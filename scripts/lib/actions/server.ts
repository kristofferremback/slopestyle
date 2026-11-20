import type { ActionsConfig } from "./config.ts";
import { type GithubClient, GithubError, type Job, listJobs, listRuns } from "./github.ts";
import { buildSnapshot, type Snapshot } from "./view.ts";

interface PollError {
  message: string;
  at: string;
}

export interface SnapshotResponse extends Snapshot {
  polledAt: string | null;
  error: PollError | null;
  loading?: true;
}

// Listing a run's jobs takes GitHub two seconds or more, and now and then fails for one run with a 502.
// So each poll lists jobs for every active run and at most `backfill` finished runs, newest first. A finished run's
// jobs no longer change, so they are listed once per attempt and update. A run whose listing fails keeps the jobs
// it last had, marked with the error, and is tried again next poll. Runs that leave the listings are forgotten.
export function createPoller(config: ActionsConfig, client: GithubClient, backfill = 8): () => Promise<Snapshot> {
  const known = new Map<number, { version: string; jobs: Job[] }>();
  return async () => {
    const pipelines = await Promise.all(
      config.pipelines.map(async (pipeline) => {
        try {
          return { ...pipeline, runs: await listRuns(client, config.repo, pipeline.workflow) };
        } catch (error) {
          const reason = error instanceof GithubError && error.status === 404 ? `${config.repo} has no workflow ${pipeline.workflow}, or the gh token cannot see it` : error instanceof Error ? error.message : String(error);
          throw new Error(`${pipeline.name} (${pipeline.workflow}): ${reason}`);
        }
      }),
    );
    const runs = pipelines.flatMap((pipeline) => pipeline.runs);
    const listed = new Set(runs.map((run) => run.id));
    for (const id of known.keys()) if (!listed.has(id)) known.delete(id);
    const version = (run: (typeof runs)[number]) => `${run.run_attempt}:${run.updated_at}`;
    const stale = runs.filter((run) => !(run.status === "completed" && known.get(run.id)?.version === version(run))).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const pending = [...stale.filter((run) => run.status !== "completed"), ...stale.filter((run) => run.status === "completed").slice(0, backfill)];
    const jobErrors = new Map<number, string>();
    // GitHub's secondary rate limit penalizes bursts of concurrent requests.
    for (let start = 0; start < pending.length; start += 4) {
      await Promise.all(
        pending.slice(start, start + 4).map(async (run) => {
          try {
            known.set(run.id, { version: version(run), jobs: await listJobs(client, config.repo, run.id) });
          } catch (error) {
            jobErrors.set(run.id, error instanceof Error ? error.message : String(error));
          }
        }),
      );
    }
    const jobs = new Map([...known].map(([id, entry]) => [id, entry.jobs]));
    return buildSnapshot({ repo: config.repo, pipelines, jobs, jobErrors });
  };
}

interface ActionsServerOptions {
  config: ActionsConfig;
  client: GithubClient;
  port: number;
  homepage?: Response | Bun.HTMLBundle;
  pollIntervalMs?: number;
}

export function createActionsServer(options: ActionsServerOptions) {
  const poller = createPoller(options.config, options.client);
  let state: SnapshotResponse = { repo: options.config.repo, pipelines: [], polledAt: null, error: null };
  let inflight: Promise<void> | null = null;
  let lastPoll = -Infinity;
  const poll = (): Promise<void> =>
    (inflight ??= poller()
      .then((snapshot) => {
        state = { ...snapshot, polledAt: new Date().toISOString(), error: null };
      })
      .catch((error: unknown) => {
        state = { ...state, error: { message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() } };
      })
      .finally(() => {
        lastPoll = Date.now();
        inflight = null;
      }));
  const snapshot = () => Response.json(state.polledAt === null && state.error === null ? { ...state, loading: true } : state);
  // GitHub is polled only while a page asks for data, which it does only while visible, so an unwatched
  // server spends none of the token's rate limit. A request answers at once and starts a poll when the data is stale.
  const view = () => {
    if (Date.now() - lastPoll >= (options.pollIntervalMs ?? 15_000)) void poll();
    return snapshot();
  };
  // The snapshot names private runs, so a page that rebinds its own hostname to 127.0.0.1 must not read it.
  type Handler = (request: Request) => Response | Promise<Response>;
  const local =
    (handler: Handler): Handler =>
    (request) =>
      [`127.0.0.1:${server.port}`, `localhost:${server.port}`].includes(request.headers.get("host") ?? "") ? handler(request) : Response.json({ error: "Forbidden" }, { status: 403 });
  const routes: Record<string, Handler> = {
    "/api/snapshot": local(view),
    "/api/refresh": local(async (request) => {
      if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
      await poll();
      return snapshot();
    }),
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    development: false,
    routes: options.homepage ? { "/": options.homepage, ...routes } : routes,
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
  });
  return server;
}
