import { isAbsolute } from "node:path";
import type { WorkConfig } from "./types.ts";

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected config object");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowed.includes(key)))
    throw new Error("Unknown config field");
  return result;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    throw new Error("Expected nonempty config string");
  return value;
}
function path(value: unknown): string {
  const result = string(value);
  if (!isAbsolute(result)) throw new Error("Config paths must be absolute");
  return result;
}
function interval(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1000 ||
    Number(value) > 86_400_000
  )
    throw new Error("Invalid poll interval");
  return Number(value);
}
export function parseWorkConfig(value: unknown): WorkConfig {
  const c = object(value, [
    "statePath",
    "watcherUrl",
    "promptRoot",
    "skillRoot",
    "poll",
    "slack",
    "t3",
    "schedule",
  ]);
  const watcher = new URL(string(c.watcherUrl));
  if (
    watcher.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(watcher.hostname) ||
    watcher.username ||
    watcher.password ||
    watcher.search ||
    watcher.hash
  )
    throw new Error("watcherUrl must be loopback HTTP");
  const p = object(c.poll === undefined ? {} : c.poll, ["githubMs", "slackMs"]);
  const t =
    c.t3 === undefined
      ? undefined
      : object(c.t3, ["modulePath", "configPath", "threadId", "projectId"]);
  const s = object(c.schedule === undefined ? {} : c.schedule, [
    "time",
    "timezone",
    "weekdays",
  ]);
  const time = s.time === undefined ? "08:00" : string(s.time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Invalid schedule time");
  const timezone =
    s.timezone === undefined ? "Europe/Stockholm" : string(s.timezone);
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const weekdays = s.weekdays === undefined ? [1, 2, 3, 4, 5] : s.weekdays;
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(weekdays).size !== weekdays.length
  )
    throw new Error("Invalid weekdays");
  let slack: WorkConfig["slack"];
  if (c.slack !== undefined) {
    const a = object(c.slack, [
      "email",
      "workspace",
      "user",
      "discoveryQuery",
      "codexPath",
    ]);
    slack = {
      email: string(a.email),
      workspace: string(a.workspace),
      user: string(a.user),
      discoveryQuery: string(a.discoveryQuery),
      codexPath: a.codexPath === undefined ? "codex" : string(a.codexPath),
    };
    if (
      !/^[TE][A-Z0-9]+$/.test(slack.workspace) ||
      !/^[UW][A-Z0-9]+$/.test(slack.user)
    )
      throw new Error("Invalid Slack identity scope");
  }
  return {
    statePath: path(c.statePath),
    watcherUrl: watcher.href,
    promptRoot: path(c.promptRoot),
    skillRoot: path(c.skillRoot),
    poll: {
      githubMs: interval(p.githubMs, 60_000),
      slackMs: interval(p.slackMs, 300_000),
    },
    slack,
    t3: t
      ? {
          modulePath: path(t.modulePath),
          configPath: path(t.configPath),
          threadId: string(t.threadId),
          projectId: string(t.projectId),
        }
      : undefined,
    schedule: { time, timezone, weekdays },
  };
}
export async function loadWorkConfig(file: string): Promise<WorkConfig> {
  return parseWorkConfig(await Bun.file(file).json());
}
