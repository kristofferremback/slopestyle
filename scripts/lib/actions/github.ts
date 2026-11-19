export interface WorkflowRun {
  id: number;
  run_number: number;
  run_attempt: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  display_title: string;
  html_url: string;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  actor: { login: string } | null;
}

export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
}

export class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message ? `GitHub ${status}: ${message}` : `GitHub ${status}`);
  }
}

interface Page {
  body: unknown;
  next: string | null;
}

export interface GithubClient {
  getJson<T>(url: string): Promise<T>;
  getAll<T>(url: string, pick: (body: any) => T[]): Promise<T[]>;
}

interface GithubClientOptions {
  token: string;
  fetch?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
}

// A 304 replays the cached page; GitHub does not count those against the rate limit.
// Pages unused for ten minutes are dropped, since finished runs are never asked for again.
// GitHub's 5xx responses and dropped connections are usually momentary, so each request retries once.
export function createGithubClient(options: GithubClientOptions): GithubClient {
  const fetcher = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const cache = new Map<string, { etag: string; page: Page; used: number }>();
  const request = async (url: string, etag: string | undefined): Promise<Response> => {
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${options.token}`,
      "x-github-api-version": "2022-11-28",
      ...(etag ? { "if-none-match": etag } : {}),
    };
    // A stalled connection would otherwise hold the shared poll forever.
    const attempt = () => fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    try {
      const response = await attempt();
      if (response.status < 500) return response;
    } catch {}
    await Bun.sleep(retryDelayMs);
    return attempt();
  };
  const getPage = async (url: string): Promise<Page> => {
    const now = Date.now();
    for (const [key, entry] of cache) if (now - entry.used > 600_000) cache.delete(key);
    const cached = cache.get(url);
    const response = await request(url, cached?.etag);
    if (response.status === 304 && cached) {
      cached.used = now;
      return cached.page;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new GithubError(response.status, body?.message ?? response.statusText);
    }
    const next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    const page = { body: await response.json(), next };
    const etag = response.headers.get("etag");
    if (etag) cache.set(url, { etag, page, used: now });
    return page;
  };
  return {
    getJson: async <T>(url: string) => (await getPage(url)).body as T,
    getAll: async <T>(url: string, pick: (body: any) => T[]) => {
      const items: T[] = [];
      for (let next: string | null = url, pages = 0; next && pages < 5; pages += 1) {
        const page: Page = await getPage(next);
        items.push(...pick(page.body));
        next = page.next;
      }
      return items;
    },
  };
}

const api = "https://api.github.com";

export async function listRuns(client: GithubClient, repo: string, workflow: string): Promise<WorkflowRun[]> {
  const body = await client.getJson<{ workflow_runs: WorkflowRun[] }>(`${api}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=20`);
  return body.workflow_runs;
}

export function listJobs(client: GithubClient, repo: string, runId: number): Promise<Job[]> {
  return client.getAll<Job>(`${api}/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, (body: { jobs: Job[] }) => body.jobs);
}
