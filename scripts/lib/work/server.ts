import { InvalidSlackThread, FollowLimitReached } from "./validation.ts";
import { loadPrompt } from "./prompts.ts";
import type { WorkStore } from "./store.ts";
import type { RunType, WorkConfig, WorkRun } from "./types.ts";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    throw new HttpError(400, "Invalid identifier");
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new HttpError(400, "Invalid sequence");
  return Number(value);
}
function runType(value: unknown): RunType {
  if (
    value !== "morning" &&
    value !== "pr-triage" &&
    value !== "slack-follow-up"
  )
    throw new HttpError(400, "Invalid prompt type");
  return value;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Expected JSON");
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (request.body)
    for await (const chunk of request.body) {
      size += chunk.length;
      if (size > 16_384) throw new HttpError(413, "Request too large");
      chunks.push(chunk);
    }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON object");
  }
}
export function workStatus(store: WorkStore, runtime?: unknown) {
  const slack = store.records("slack");
  const recentMessages = slack
    .filter((row) => row.key.startsWith("message:"))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 20);
  const followed = new Set(
    store.followed().map((row) => `thread:${row.channel}:${row.rootTs}`),
  );
  const runs = store
    .runs()
    .slice(-20)
    .map(({ prompt, ...run }) => ({ ...run, hash: prompt.hash }));
  return {
    records: {
      github: store.records("github"),
      slack: [
        ...recentMessages,
        ...slack.filter((row) => followed.has(row.key)),
      ],
    },
    health: { github: store.health("github"), slack: store.health("slack") },
    followed: store.followed(),
    latestSeq: store.latestSeq(),
    runs,
    cursors: {
      morning: store.cursor("run:morning"),
      "pr-triage": store.cursor("run:pr-triage"),
      "slack-follow-up": store.cursor("run:slack-follow-up"),
    },
    runtime: runtime ?? null,
  };
}
export function createWorkServer(options: {
  store: WorkStore;
  config: WorkConfig;
  port: number;
  homepage?: Response | Bun.HTMLBundle;
  refresh?: () => Promise<void>;
  runtimeStatus?: () => unknown;
  prepare?: (type: RunType) => Promise<WorkRun>;
}) {
  const { store, config } = options;
  return Bun.serve({
    development: false,
    hostname: "127.0.0.1",
    port: options.port,
    routes:
      options.homepage && !(options.homepage instanceof Response)
        ? { "/": options.homepage }
        : undefined,
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const host = request.headers.get("host");
        if (
          host !== url.host ||
          !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        )
          throw new HttpError(403, "Local access required");
        if (request.method !== "GET" && request.method !== "POST")
          throw new HttpError(405, "Method not allowed");
        if (request.method === "POST") {
          const origin = request.headers.get("origin");
          if (
            (origin && origin !== url.origin) ||
            request.headers.get("sec-fetch-site") === "cross-site"
          )
            throw new HttpError(403, "Same-origin access required");
        }
        const path = url.pathname;
        let data: unknown;
        if (request.method === "GET") {
          if (path === "/" && options.homepage instanceof Response)
            return options.homepage.clone();
          if (path === "/api/status")
            data = workStatus(store, options.runtimeStatus?.());
          else if (path === "/api/changes") {
            const consumer = text(url.searchParams.get("consumer"));
            const after = url.searchParams.has("after")
              ? integer(Number(url.searchParams.get("after")))
              : store.cursor(consumer);
            const limit = url.searchParams.has("limit")
              ? integer(Number(url.searchParams.get("limit")))
              : 100;
            if (limit < 1 || limit > 1000)
              throw new HttpError(400, "Invalid limit");
            const through = url.searchParams.has("through")
              ? integer(Number(url.searchParams.get("through")))
              : store.latestSeq();
            const changes = store
              .changes(after, limit)
              .filter((change) => change.seq <= through);
            data = {
              changes,
              cursor: store.cursor(consumer),
              nextCursor:
                changes.at(-1)?.seq ?? Math.min(after, store.latestSeq()),
              latestSeq: store.latestSeq(),
            };
          } else if (path.startsWith("/api/prompts/")) {
            const type = runType(path.slice("/api/prompts/".length));
            data = await loadPrompt(config.promptRoot, config.skillRoot, type);
          } else if (path.startsWith("/api/runs/")) {
            data = store.run(
              decodeURIComponent(path.slice("/api/runs/".length)),
            );
            if (!data) throw new HttpError(404, "Run not found");
          } else throw new HttpError(404, "Not found");
        } else {
          const input = await body(request);
          if (path === "/api/ack") {
            if (
              !store.acknowledge(
                text(input.consumer),
                integer(input.expected),
                integer(input.through),
              )
            )
              throw new HttpError(409, "Cursor changed");
            data = { ok: true };
          } else if (path === "/api/follow" || path === "/api/unfollow") {
            const channel = text(input.channel);
            const rootTs = text(input.rootTs);
            if (path === "/api/follow") store.follow(channel, rootTs);
            else store.unfollow(channel, rootTs);
            data = { followed: store.followed() };
          } else if (path === "/api/refresh") {
            if (!options.refresh)
              throw new HttpError(503, "Refresh unavailable");
            await options.refresh();
            data = workStatus(store, options.runtimeStatus?.());
          } else if (path === "/api/prepare") {
            if (!options.prepare)
              throw new HttpError(503, "Preparation unavailable");
            data = await options.prepare(runType(input.type));
          } else if (/^\/api\/runs\/[^/]+\/complete$/.test(path)) {
            const id = decodeURIComponent(path.split("/")[3]);
            const run = store.run(id);
            if (!run) throw new HttpError(404, "Run not found");
            if (run.state !== "dispatched" && run.state !== "completed")
              throw new HttpError(409, "Run has not been dispatched");
            data = store.completeRun(id);
          } else throw new HttpError(404, "Not found");
        }
        return Response.json(data, {
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        if (error instanceof InvalidSlackThread)
          error = new HttpError(400, error.message);
        if (error instanceof FollowLimitReached)
          error = new HttpError(409, error.message);
        return Response.json(
          {
            error:
              error instanceof HttpError ? error.message : "Request failed",
          },
          {
            status: error instanceof HttpError ? error.status : 400,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
    },
  });
}
