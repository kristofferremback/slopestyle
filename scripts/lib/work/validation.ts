export const SLACK_DISCOVERY_LIMIT = 20;
export const SLACK_FOLLOW_LIMIT = 100;
export const SLACK_THREAD_PAGE_LIMIT = 100;
export const SLACK_THREAD_PAGES = 4;

export class InvalidSlackThread extends Error {
  constructor() {
    super("Invalid Slack thread");
  }
}
export class FollowLimitReached extends Error {
  constructor() {
    super("Follow limit reached");
  }
}
export function validateSlackThread(channel: string, rootTs: string): void {
  if (!/^[CGD][A-Z0-9]+$/.test(channel) || !/^\d{10}\.\d{1,6}$/.test(rootTs))
    throw new InvalidSlackThread();
}
