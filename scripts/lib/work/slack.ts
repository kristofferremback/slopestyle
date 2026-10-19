import {
  validateSlackThread,
  SLACK_DISCOVERY_LIMIT,
  SLACK_THREAD_PAGE_LIMIT,
  SLACK_THREAD_PAGES,
} from "./validation.ts";
import type { ManagedSession, SlackConfig } from "./managed-apps.ts";
export interface SlackMessage {
  kind: "message";
  channel: string;
  messageTs: string;
  url: string;
  text: string;
  author: string;
}
export interface SlackThread {
  kind: "thread";
  channel: string;
  rootTs: string;
  url: string;
  text: string;
  complete: boolean;
}
const invalid = () =>
  new Error("Slack returned unsupported or incomplete evidence");
const rendered = (s: string) => s.replace(/\\n/g, "\n").replace(/\\\//g, "/");
export function parseSlackSearch(raw: any): SlackMessage[] {
  if (
    typeof raw?.results !== "string" ||
    typeof raw.pagination_info !== "string" ||
    raw.results.length > 1_000_000
  )
    throw invalid();
  const content = rendered(raw.results),
    count = /^## Messages \((\d+) results\)$/m.exec(content);
  if (!count || Number(count[1]) > SLACK_DISCOVERY_LIMIT) throw invalid();
  const parts = content.split(/^### Result \d+ of \d+\s*$/m).slice(1);
  if (parts.length !== Number(count[1])) throw invalid();
  return parts.map((part) => {
    const textAt = part.indexOf("\nText:");
    if (textAt < 0) throw invalid();
    const header = part.slice(0, textAt),
      text = part
        .slice(textAt + 6)
        .replace(/^\s*\n/, "")
        .replace(/\n\n---\s*$/, "")
        .trim();
    const channel = /^Channel: .+ \(ID: ([CDG][A-Z0-9]+)\)$/m.exec(header)?.[1];
    const author =
      /^From: (.*) \(ID: ([UW][A-Z0-9]+)\)\s*(?:\[BOT\])?\s*$/m.exec(
        header,
      )?.[1];
    const messageTs = /^Message_ts: (\d{10}\.\d{1,6})$/m.exec(header)?.[1];
    const url = /^Permalink: \[link\]\((https:\/\/[^\s)]+)\)$/m.exec(
      header,
    )?.[1];
    if (!channel || author === undefined || !messageTs || !url) throw invalid();
    const u = new URL(url);
    if (
      u.username ||
      u.password ||
      u.port ||
      !/^[a-z0-9-]+\.slack\.com$/.test(u.hostname) ||
      u.pathname !==
        `/archives/${channel}/p${messageTs.replace(".", "").padEnd(16, "0")}`
    )
      throw invalid();
    return { kind: "message", channel, messageTs, url, text, author };
  });
}
export function parseSlackThread(
  raw: any,
  channel: string,
  rootTs: string,
): {
  text: string;
  cursor: string | null;
  complete: boolean;
  timestamps: string[];
} {
  if (
    typeof raw?.messages !== "string" ||
    typeof raw.pagination_info !== "string" ||
    raw.messages.length > 1_000_000
  )
    throw invalid();
  const text = rendered(raw.messages),
    headers = [
      ...text.matchAll(/^From: [^\n]*\nTime: [^\n]*\nMessage TS: ([^\n]*)$/gm),
    ];
  validateSlackThread(channel, rootTs);
  const stamps = headers.map((header) => header[1].trim());
  if (
    !stamps.length ||
    stamps.length > SLACK_THREAD_PAGE_LIMIT ||
    stamps.some((stamp) => !/^\d{10}\.\d{1,6}$/.test(stamp)) ||
    new Set(stamps).size !== stamps.length
  )
    throw invalid();
  const cursor = /cursor:? `([^`]+)`/.exec(raw.pagination_info)?.[1] ?? null;
  if (cursor && cursor.length > 2048) throw invalid();
  return {
    text,
    timestamps: stamps,
    cursor,
    complete:
      !cursor &&
      raw.pagination_info.trim() ===
        "There are no more messages in this thread.",
  };
}
export async function readFollowedThread(
  session: ManagedSession,
  cfg: SlackConfig,
  channel: string,
  rootTs: string,
): Promise<SlackThread> {
  const pages: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null,
    complete = false;
  for (let page = 0; page < SLACK_THREAD_PAGES; page++) {
    const raw = await session.call("slack.slack_read_thread", {
      channel_id: channel,
      message_ts: rootTs,
      limit: SLACK_THREAD_PAGE_LIMIT,
      response_format: "detailed",
      ...(cursor ? { cursor } : {}),
    });
    const result = parseSlackThread(raw, channel, rootTs);
    if (page === 0 && !result.timestamps.includes(rootTs)) throw invalid();
    pages.push(result.text);
    complete = result.complete;
    if (!result.cursor) break;
    if (cursors.has(result.cursor)) throw invalid();
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  return {
    kind: "thread",
    channel,
    rootTs,
    url: `https://app.slack.com/client/${cfg.workspace}/${channel}/thread/${channel}-${rootTs}`,
    text: pages.join("\n\n"),
    complete,
  };
}
