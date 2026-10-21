import { enrichGithub, type GithubCommand } from "./github-facts.ts";
import type { GithubRecord } from "./github.ts";
import {
  SLACK_DISCOVERY_LIMIT,
  SLACK_FOLLOW_LIMIT,
  SLACK_THREAD_PAGES,
  SLACK_THREAD_PAGE_LIMIT,
} from "./validation.ts";
import { GITHUB_MAX_AGE_MS, GITHUB_PARTIAL_GAP, readGithub, type GithubFetcher } from "./github.ts";
import {
  openManagedSession,
  type ManagedSession,
  type SlackConfig,
} from "./managed-apps.ts";
import { parseSlackSearch, readFollowedThread } from "./slack.ts";
import type { WorkStore } from "./store.ts";
import type { Json, WorkConfig } from "./types.ts";
export async function collectGithub(
  store: WorkStore,
  cfg: WorkConfig,
  options: {
    now?: Date;
    fetcher?: GithubFetcher;
    githubCommand?: GithubCommand;
  } = {},
): Promise<void> {
  const now = options.now ?? new Date(),
    at = now.toISOString();
  // A concurrent status read must not mistake an in-flight attempt for success.
  store.fail("github", at, "GitHub collection in progress");
  try {
    const snapshot = await readGithub(cfg.watcherUrl, options.fetcher);
    const last = Date.parse(snapshot.succeededAt),
      previous = store.health("github").succeededAt;
    if (
      last > now.getTime() + 60_000 ||
      now.getTime() - last > GITHUB_MAX_AGE_MS ||
      (previous && last < Date.parse(previous))
    )
      throw new Error("stale");
    const gap = await enrichGithub(
      snapshot.records,
      new Map(
        store
          .records("github")
          .map((r) => [r.key, r.data as unknown as GithubRecord]),
      ),
      at,
      options.githubCommand,
    );
    store.applySnapshot(
      "github",
      snapshot.records.map((r) => ({
        key: r.key,
        data: r.data as unknown as Json,
      })),
      at,
      true,
      {
        succeededAt: snapshot.succeededAt,
        ...(gap
          ? { gap: GITHUB_PARTIAL_GAP }
          : { gap: "" }),
      },
    );
  } catch {
    store.fail(
      "github",
      at,
      "PR watcher unavailable, stale, or invalid; previous evidence retained",
    );
  }
}
export async function collectSlack(
  store: WorkStore,
  cfg: WorkConfig,
  options: {
    now?: Date;
    openSession?: (cfg: SlackConfig) => Promise<ManagedSession>;
  } = {},
): Promise<void> {
  const now = options.now ?? new Date(),
    at = now.toISOString();
  store.attempt("slack", at);
  if (!cfg.slack) {
    store.fail("slack", at, "Slack is not configured");
    return;
  }
  let session: ManagedSession | undefined;
  try {
    session = await (options.openSession ?? openManagedSession)(cfg.slack);
    const previous = store.health("slack").succeededAt;
    const since = new Date(
      (previous ? Date.parse(previous) : now.getTime() - 14 * 86400_000) -
        86400_000,
    )
      .toISOString()
      .slice(0, 10);
    const rows: { key: string; data: Json }[] = [];
    let failed = false;
    try {
      const raw = await session.call("slack.slack_search_public_and_private", {
        keywords: [],
        filters: `${cfg.slack.discoveryQuery} after:${since}`,
        natural_language_query: "",
        content_types: "messages",
        limit: SLACK_DISCOVERY_LIMIT,
        include_bots: false,
        include_context: false,
        only_my_channels: true,
        sort: "timestamp",
        sort_dir: "desc",
        response_format: "detailed",
      });
      for (const data of parseSlackSearch(raw))
        rows.push({
          key: `message:${data.channel}:${data.messageTs}`,
          data: data as unknown as Json,
        });
    } catch {
      failed = true;
    }
    let incomplete = false;
    const followed = store.followed();
    for (const { channel, rootTs } of followed.slice(0, SLACK_FOLLOW_LIMIT)) {
      try {
        const data = await readFollowedThread(
          session,
          cfg.slack,
          channel,
          rootTs,
        );
        incomplete ||= !data.complete;
        const key = `thread:${channel}:${rootTs}`;
        if (data.complete || !store.records("slack").some((r) => r.key === key))
          rows.push({ key, data: data as unknown as Json });
      } catch {
        failed = true;
      }
    }
    incomplete ||= followed.length > SLACK_FOLLOW_LIMIT;
    const coverage = failed
      ? "some reads failed; previous evidence retained"
      : incomplete
        ? "followed thread coverage incomplete"
        : `${followed.length} followed threads checked completely`;
    const gap = [
      `Bounded discovery (${SLACK_DISCOVERY_LIMIT} recent messages)`,
      `followed threads limited to ${SLACK_FOLLOW_LIMIT} threads, ${SLACK_THREAD_PAGES} pages of ${SLACK_THREAD_PAGE_LIMIT} messages each`,
      coverage,
    ].join("; ");
    store.applySnapshot("slack", rows, at, false, {
      ...(!failed && !incomplete ? { succeededAt: at } : {}),
      gap,
    });
  } catch {
    store.fail(
      "slack",
      at,
      "Slack managed read unavailable or unverified; previous evidence retained",
    );
  } finally {
    try {
      await session?.close();
    } catch {
      /* teardown never exposes provider errors */
    }
  }
}
