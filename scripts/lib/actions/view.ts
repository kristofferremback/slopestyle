import type { Job, WorkflowRun } from "./github.ts";

// What a run, group or job looks like to the user. "failing" is a run or group still in progress with a failed job.
export type State = "queued" | "running" | "failing" | "waiting" | "success" | "failure" | "cancelled" | "skipped";

export interface JobView {
  name: string;
  state: State;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
}

export interface GroupView {
  name: string;
  state: State;
  startedAt: string | null;
  completedAt: string | null;
  jobs: JobView[];
}

interface SameCommit {
  pipeline: string;
  id: number;
  number: number;
  url: string;
}

export interface RunView {
  id: number;
  number: number;
  attempt: number;
  title: string;
  event: string;
  branch: string | null;
  sha: string;
  actor: string | null;
  status: string | null;
  state: State;
  url: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  groups: GroupView[];
  failedJobs: { name: string; url: string | null }[];
  // Why the run's jobs could not be listed this poll; the jobs shown are the last ones listed, if any.
  jobsError: string | null;
  sameCommit: SameCommit[];
}

export interface PipelineView {
  name: string;
  workflow: string;
  url: string;
  runs: RunView[];
}

export interface Snapshot {
  repo: string;
  pipelines: PipelineView[];
}

interface SnapshotInput {
  repo: string;
  pipelines: { name: string; workflow: string; runs: WorkflowRun[] }[];
  jobs: Map<number, Job[]>;
  jobErrors?: Map<number, string>;
}

const failing = new Set(["failure", "timed_out", "startup_failure"]);
const isFailed = (job: Job): boolean => job.conclusion !== null && failing.has(job.conclusion);

function stateOf(status: string | null, conclusion: string | null, failed: boolean): State {
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "cancelled") return "cancelled";
    if (conclusion === "skipped" || conclusion === "neutral") return "skipped";
    if (conclusion === "action_required") return "waiting";
    return "failure";
  }
  if (status === "in_progress") return failed ? "failing" : "running";
  return status === "waiting" ? "waiting" : "queued";
}

// The earliest (sign -1) or latest (sign 1) timestamp, or null when none is set.
function extreme(values: (string | null)[], sign: 1 | -1): string | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => (sign * (Date.parse(b) - Date.parse(a)) > 0 ? b : a));
}

// GitHub names a reusable workflow's jobs "Caller / job". A " / " inside parentheses belongs to a matrix value.
function splitGroup(name: string): [string, string] {
  let depth = 0;
  for (let index = 0; index < name.length; index += 1) {
    if (name[index] === "(") depth += 1;
    else if (name[index] === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && name.startsWith(" / ", index) && index + 3 < name.length) return [name.slice(0, index), name.slice(index + 3)];
  }
  return [name, name];
}

function groupState(jobs: Job[]): State {
  if (jobs.every((job) => job.status === "completed")) {
    if (jobs.some(isFailed)) return "failure";
    if (jobs.some((job) => job.conclusion === "cancelled")) return "cancelled";
    return jobs.every((job) => job.conclusion === "skipped") ? "skipped" : "success";
  }
  const started = jobs.some((job) => job.status === "completed" || job.status === "in_progress");
  return started ? stateOf("in_progress", null, jobs.some(isFailed)) : "queued";
}

function groupJobs(jobs: Job[]): GroupView[] {
  const byName = new Map<string, { job: Job; name: string }[]>();
  for (const job of jobs) {
    const [group, name] = splitGroup(job.name);
    byName.set(group, [...(byName.get(group) ?? []), { job, name }]);
  }
  return [...byName].map(([name, members]) => {
    const state = groupState(members.map((member) => member.job));
    const done = members.every((member) => member.job.status === "completed");
    return {
      name,
      state,
      startedAt: extreme(members.map((member) => member.job.started_at), -1),
      completedAt: done ? extreme(members.map((member) => member.job.completed_at), 1) : null,
      jobs: members.map(({ job, name }) => ({ name, state: stateOf(job.status, job.conclusion, false), startedAt: job.started_at, completedAt: job.completed_at, url: job.html_url })),
    };
  });
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  return {
    repo: input.repo,
    pipelines: input.pipelines.map((pipeline) => {
      const runs = pipeline.runs.map((run): RunView => {
        const jobs = input.jobs.get(run.id) ?? [];
        return {
          id: run.id,
          number: run.run_number,
          attempt: run.run_attempt,
          title: run.display_title,
          event: run.event,
          branch: run.head_branch,
          sha: run.head_sha,
          actor: run.actor?.login ?? null,
          status: run.status,
          state: stateOf(run.status, run.conclusion, jobs.some(isFailed)),
          url: run.html_url,
          createdAt: run.created_at,
          startedAt: run.run_started_at ?? run.created_at,
          updatedAt: run.updated_at,
          groups: groupJobs(jobs),
          jobsError: input.jobErrors?.get(run.id) ?? null,
          failedJobs: jobs.filter(isFailed).map((job) => ({ name: job.name, url: job.html_url })),
          sameCommit: input.pipelines
            .filter((other) => other.name !== pipeline.name)
            .flatMap((other) => other.runs.filter((match) => match.head_sha === run.head_sha).map((match) => ({ pipeline: other.name, id: match.id, number: match.run_number, url: match.html_url }))),
        };
      });
      const active = (run: RunView) => (run.status === "completed" ? 1 : 0);
      runs.sort((a, b) => active(a) - active(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return { name: pipeline.name, workflow: pipeline.workflow, url: `https://github.com/${input.repo}/actions/workflows/${pipeline.workflow}`, runs };
    }),
  };
}
