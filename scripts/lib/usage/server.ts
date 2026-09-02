import type { Database } from "bun:sqlite";
import { ingest, type IngestOptions } from "./ingest.ts";
import { insights } from "./insights.ts";
import { type Fetcher, fetchUsage, limitsView, pollLimits, type TokenSource } from "./limits.ts";
import { type Bucket, bucketMs, type Range, sessionDetail, sessions, timeline } from "./query.ts";

export interface ServerOptions {
  db: Database;
  ingest: IngestOptions;
  port: number;
  homepage?: Response | Bun.HTMLBundle;
  // How long a completed ingest stays fresh before a read triggers another one.
  refreshAfterMs?: number;
  // Where the OAuth token for the usage endpoint comes from. Without it the
  // server never polls limits.
  tokenSource?: TokenSource;
  fetcher?: Fetcher;
  pollIntervalMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Parses from/to/tz query parameters into a half-open range. Defaults to the
// local day in the caller's timezone offset.
export function parseRange(params: URLSearchParams, now = Date.now()): { range: Range; offsetMinutes: number } {
  const offsetParam = params.get("tz");
  const offsetMinutes = offsetParam === null ? 0 : Number(offsetParam);
  if (!Number.isFinite(offsetMinutes)) throw new HttpError(400, "tz must be a UTC offset in minutes");
  const shift = offsetMinutes * 60_000;
  const parse = (name: string): number | undefined => {
    const value = params.get(name);
    if (value === null || value === "") return undefined;
    // A bare date means that local day, like the default range.
    const ms = /^\d+$/.test(value) ? Number(value) : /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) - shift : Date.parse(value);
    if (!Number.isFinite(ms)) throw new HttpError(400, `${name} must be an ISO timestamp or unix milliseconds`);
    return ms;
  };
  const localMidnight = Math.floor((now + shift) / 86_400_000) * 86_400_000 - shift;
  const fromMs = parse("from") ?? localMidnight;
  const toMs = parse("to") ?? fromMs + 86_400_000;
  if (toMs <= fromMs) throw new HttpError(400, "to must be after from");
  return { range: { fromMs, toMs }, offsetMinutes };
}

export function parseBucket(params: URLSearchParams, range: Range): Bucket {
  const value = params.get("bucket");
  if (value === null) {
    const span = range.toMs - range.fromMs;
    return span <= 6 * 3_600_000 ? "15m" : span <= 3 * 86_400_000 ? "hour" : "day";
  }
  if (value in bucketMs) return value as Bucket;
  throw new HttpError(400, "bucket must be 15m, hour, or day");
}

export function createServer(options: ServerOptions) {
  const refreshAfterMs = options.refreshAfterMs ?? 10_000;
  let lastIngest = 0;
  const refresh = (force = false) => {
    if (!force && Date.now() - lastIngest < refreshAfterMs) return undefined;
    try {
      return ingest(options.db, options.ingest);
    } finally {
      lastIngest = Date.now();
    }
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const poll = async () => {
    if (!options.tokenSource) return null;
    return pollLimits(options.db, options.tokenSource, options.fetcher ?? fetchUsage);
  };
  const windowSpend = options.db.query<{ total: number }, [number, number]>("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM requests WHERE ts_ms >= ? AND ts_ms < ?");
  const handle = (fn: (url: URL) => unknown) => (request: Request) => {
    try {
      refresh();
      return json(fn(new URL(request.url)));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      throw error;
    }
  };
  const routes: Record<string, (request: Request & { params?: Record<string, string> }) => Response | Promise<Response>> = {
    "/api/timeline": handle((url) => {
      const { range, offsetMinutes } = parseRange(url.searchParams);
      return timeline(options.db, range, parseBucket(url.searchParams, range), offsetMinutes);
    }),
    "/api/sessions": handle((url) => sessions(options.db, parseRange(url.searchParams).range)),
    "/api/sessions/:id": (request) => {
      const url = new URL(request.url);
      try {
        refresh();
        const detail = sessionDetail(options.db, request.params!.id, parseRange(url.searchParams).range);
        return detail ? json(detail) : json({ error: "No requests for that session in the range" }, 404);
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message }, error.status);
        throw error;
      }
    },
    "/api/limits": handle((url) => {
      const { range } = parseRange(url.searchParams);
      const view = limitsView(options.db, range.fromMs, range.toMs);
      return { ...view, polling: options.tokenSource !== undefined, windows: view.windows.map((window) => ({ ...window, spend_usd: windowSpend.get(window.start_ms, window.end_ms)!.total })) };
    }),
    "/api/insights": handle((url) => insights(options.db, parseRange(url.searchParams).range)),
    "/api/refresh": async (request) => {
      if (request.method !== "POST") return json({ error: "Use POST" }, 405);
      const stats = refresh(true);
      return json({ ...stats, limits: await poll() });
    },
  };
  refresh(true);
  void poll();
  const timer = options.tokenSource ? setInterval(() => void poll(), options.pollIntervalMs ?? 120_000) : undefined;
  timer?.unref();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    // Production bundling: minified assets and no hot-reload client.
    development: false,
    routes: options.homepage ? { "/": options.homepage, ...routes } : routes,
    fetch: () => json({ error: "Not found" }, 404),
  });
  if (timer) {
    const stop = server.stop.bind(server);
    Object.defineProperty(server, "stop", {
      value: (closeActiveConnections?: boolean) => {
        clearInterval(timer);
        return stop(closeActiveConnections);
      },
    });
  }
  return server;
}
