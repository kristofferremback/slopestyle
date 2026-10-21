export type Source = "github" | "slack";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface WorkRecord {
  source: Source;
  key: string;
  data: Json;
  digest: string;
  observedAt: string;
}
export interface Change {
  seq: number;
  source: Source;
  key: string;
  kind: "upsert" | "remove";
  data: Json;
  observedAt: string;
}
export interface SourceHealth {
  source: Source;
  attemptedAt: string | null;
  succeededAt: string | null;
  gap: string | null;
}
export interface PromptSnapshot {
  text: string;
  hash: string;
}
export type RunType = "morning" | "pr-triage" | "slack-follow-up";
export interface WorkRun {
  id: string;
  date: string;
  type: RunType;
  state: "pending" | "prepared" | "dispatched" | "completed";
  prompt: PromptSnapshot;
  throughSeq: number;
}
export interface WorkConfig {
  statePath: string;
  watcherUrl: string;
  promptRoot: string;
  skillRoot: string;
  poll: { githubMs: number; slackMs: number };
  slack?: {
    email: string;
    workspace: string;
    user: string;
    discoveryQuery: string;
    codexPath: string;
  };
  t3?: {
    modulePath: string;
    configPath: string;
    threadId: string;
    projectId: string;
  };
  schedule: { time: string; timezone: string; weekdays: number[] };
}

export interface PRSnooze {
  key: string;
  version: number;
  until: number | null;
  durationHours: 1 | 24 | null;
}
