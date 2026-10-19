export interface GithubRecord {
  kind: "pr";
  title: string;
  url: string;
  repository: string;
  number: number;
  owned: boolean;
  requested: boolean;
  hidden: boolean;
  draft: boolean;
  status: string;
  head: string;
  threadUrl: string;
}
export interface GithubSnapshot {
  records: { key: string; data: GithubRecord }[];
  succeededAt: string;
}
export type GithubFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const invalid = () =>
  new Error("PR watcher returned invalid or unavailable evidence");
function string(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max) throw invalid();
  return value;
}
function url(value: unknown, empty = false): string {
  const s = string(value);
  if (!s && empty) return s;
  const u = new URL(s);
  if (
    (u.protocol !== "https:" && u.protocol !== "http:") ||
    u.username ||
    u.password
  )
    throw invalid();
  return s;
}
export function parseGithub(raw: unknown): GithubSnapshot {
  const r = raw as Record<string, unknown>;
  if (
    !r ||
    r.ok !== true ||
    r.lastError != null ||
    typeof r.lastSuccessfulPoll !== "string" ||
    !Number.isFinite(Date.parse(r.lastSuccessfulPoll))
  )
    throw invalid();
  const rows = new Map<string, GithubRecord>();
  for (const group of ["myPullRequests", "queue", "hidden"]) {
    const items = r[group];
    if (!Array.isArray(items) || items.length > 5000) throw invalid();
    for (const item of items) {
      if (
        !item ||
        typeof item !== "object" ||
        !Number.isSafeInteger(item.number) ||
        item.number < 1
      )
        throw invalid();
      for (const field of ["owned", "requested", "hidden", "draft"])
        if (typeof item[field] !== "boolean") throw invalid();
      const key = string(item.key);
      if (!key || rows.has(key)) throw invalid();
      rows.set(key, {
        kind: "pr",
        title: string(item.title),
        url: url(item.url),
        repository: string(item.repository),
        number: item.number,
        owned: item.owned,
        requested: item.requested,
        hidden: item.hidden,
        draft: item.draft,
        status: string(item.status),
        head: string(item.head),
        threadUrl: url(item.review?.threadUrl ?? "", true),
      });
    }
  }
  return {
    records: [...rows]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => ({ key, data })),
    succeededAt: r.lastSuccessfulPoll,
  };
}
export async function readGithub(
  watcherUrl: string,
  fetcher: GithubFetcher = fetch,
): Promise<GithubSnapshot> {
  const target = new URL(watcherUrl);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw invalid();
  target.pathname = "/api/status";
  const response = await fetcher(target, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4_000_000) throw invalid();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseGithub(JSON.parse(Buffer.concat(chunks).toString()));
}
