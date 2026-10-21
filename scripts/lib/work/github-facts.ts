import { isDeepStrictEqual } from "node:util";
import type { GithubRecord } from "./github.ts";

export interface GithubFacts {
  checkedAt: string;
  repository: string;
  number: number;
  headOid: string;
  state: string;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  headRepository: string | null;
  viewer: string;
  author: string | null;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  checks: { name: string; status: string; conclusion: string | null }[];
  checksComplete: boolean;
  ownReview: {
    state: string;
    commitOid: string | null;
    submittedAt: string;
  } | null;
  reviewsComplete: boolean;
}
export type GithubCommand = (args: string[]) => Promise<unknown>;
const LIMIT = 40;
// This is a single read-only GraphQL operation, despite GraphQL's HTTP POST transport.
export const githubCommand: GithubCommand = async (args) => {
  const child = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const reader = child.stdout.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw new Error("GitHub output limit");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const exit = await child.exited;
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (exit !== 0 && !result?.data) throw new Error("GitHub read failed");
    return result;
  } finally {
    clearTimeout(timer);
    child.kill();
  }
};
const fields = `number repository { nameWithOwner } author { login } headRefOid state isDraft baseRefName headRefName headRepository { nameWithOwner } mergeable mergeStateStatus reviewDecision
commits(last:1) { nodes { commit { oid statusCheckRollup { contexts(first:100) { pageInfo { hasNextPage } nodes { __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }
reviews(last:100, states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) { pageInfo { hasPreviousPage } nodes { author { login } state submittedAt commit { oid } } }`;
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 4096;
const oid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
function parse(
  raw: any,
  row: GithubRecord,
  viewer: string,
  at: string,
): GithubFacts {
  if (
    !raw ||
    raw.repository?.nameWithOwner?.toLowerCase() !==
      row.repository.toLowerCase() ||
    raw.number !== row.number ||
    !oid(raw.headRefOid) ||
    !["OPEN", "CLOSED", "MERGED"].includes(raw.state) ||
    typeof raw.isDraft !== "boolean" ||
    ![
      raw.baseRefName,
      raw.headRefName,
      raw.mergeable,
      raw.mergeStateStatus,
    ].every(text) ||
    !(raw.reviewDecision === null || text(raw.reviewDecision)) ||
    !(raw.headRepository === null || text(raw.headRepository?.nameWithOwner)) ||
    !(raw.author === null || text(raw.author?.login))
  )
    throw new Error("Invalid PR facts");
  const commit =
    raw.commits?.nodes?.length === 1 ? raw.commits.nodes[0]?.commit : null;
  const contexts = commit?.statusCheckRollup?.contexts;
  const checks: GithubFacts["checks"] = [];
  let checksComplete =
    commit?.oid === raw.headRefOid &&
    (commit.statusCheckRollup === null ||
      (!!contexts &&
        Array.isArray(contexts.nodes) &&
        contexts.nodes.length <= 100 &&
        contexts.pageInfo?.hasNextPage === false));
  for (const c of contexts?.nodes ?? []) {
    if (
      c?.__typename === "CheckRun" &&
      text(c.name) &&
      text(c.status) &&
      (c.conclusion === null || text(c.conclusion))
    )
      checks.push({ name: c.name, status: c.status, conclusion: c.conclusion });
    else if (
      c?.__typename === "StatusContext" &&
      text(c.context) &&
      text(c.state)
    )
      checks.push({ name: c.context, status: c.state, conclusion: null });
    else checksComplete = false;
  }
  // Never attribute contexts fetched from a different commit to the current head.
  if (commit?.oid !== raw.headRefOid) checks.length = 0;
  const reviews = raw.reviews;
  let reviewsComplete =
    Array.isArray(reviews?.nodes) &&
    reviews.nodes.length <= 100 &&
    reviews.pageInfo?.hasPreviousPage === false;
  let ownReview: GithubFacts["ownReview"] = null;
  for (const r of reviews?.nodes ?? []) {
    if (
      !text(r?.author?.login) ||
      !text(r.state) ||
      !text(r.submittedAt) ||
      !Number.isFinite(Date.parse(r.submittedAt)) ||
      !(r.commit === null || oid(r.commit?.oid))
    ) {
      reviewsComplete = false;
      continue;
    }
    if (
      r.author.login.toLowerCase() === viewer.toLowerCase() &&
      ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state) &&
      (!ownReview || r.submittedAt > ownReview.submittedAt)
    )
      ownReview = {
        state: r.state,
        submittedAt: r.submittedAt,
        commitOid: r.commit?.oid ?? null,
      };
  }
  return {
    checkedAt: at,
    repository: raw.repository.nameWithOwner,
    number: raw.number,
    headOid: raw.headRefOid,
    state: raw.state,
    draft: raw.isDraft,
    baseBranch: raw.baseRefName,
    headBranch: raw.headRefName,
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    viewer,
    author: raw.author?.login ?? null,
    mergeable: raw.mergeable,
    mergeStateStatus: raw.mergeStateStatus,
    reviewDecision: raw.reviewDecision,
    checks,
    checksComplete: !!checksComplete,
    ownReview,
    reviewsComplete: !!reviewsComplete,
  };
}
export async function enrichGithub(
  rows: { key: string; data: GithubRecord }[],
  previous: Map<string, GithubRecord>,
  at: string,
  command: GithubCommand = githubCommand,
): Promise<boolean> {
  let gap = rows.length > LIMIT;
  let response: any;
  const candidates = rows
    .slice(0, LIMIT)
    .filter(({ data }) => /^[\w.-]+\/[\w.-]+$/.test(data.repository));
  try {
    if (candidates.length) {
      const query = `query { viewer { login } ${candidates
        .map(({ data }, i) => {
          const [owner, name] = data.repository.split("/");
          return `p${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { pullRequest(number:${data.number}) { ${fields} } }`;
        })
        .join("\n")} }`;
      response = await command([
        "api",
        "graphql",
        "--hostname",
        "github.com",
        "-f",
        `query=${query}`,
      ]);
    }
  } catch {
    gap = true;
  }
  for (const row of rows) {
    const old = previous.get(row.key);
    const index = candidates.indexOf(row);
    try {
      if (
        index < 0 ||
        !text(response?.data?.viewer?.login) ||
        !response.data.viewer.login ||
        response.errors?.some(
          (error: { path?: unknown[] }) =>
            !Array.isArray(error.path) ||
            error.path[0] === "viewer" ||
            error.path[0] === `p${index}`,
        )
      )
        throw new Error("Incomplete GitHub batch");
      const facts = parse(
        response.data[`p${index}`]?.pullRequest,
        row.data,
        response.data.viewer.login,
        at,
      );
      const before = old?.facts;
      // checkedAt records the last verification that changed stored facts. Source
      // health.attemptedAt records subsequent checks without poll-only change events.
      if (
        before &&
        isDeepStrictEqual({ ...before, checkedAt: "" }, { ...facts, checkedAt: "" })
      )
        facts.checkedAt = before.checkedAt;
      row.data.facts = facts;
      const headMatches =
        !row.data.expectedHead || row.data.expectedHead === facts.headOid;
      if (!headMatches) {
        row.data.factsGap = "GitHub head differs from watcher expected head";
        gap = true;
      } else if (!facts.checksComplete || !facts.reviewsComplete) {
        row.data.factsGap = "GitHub connection coverage incomplete";
        gap = true;
      } else delete row.data.factsGap;
    } catch {
      gap = true;
      if (old?.facts) row.data.facts = old.facts;
      row.data.factsGap =
        "GitHub facts unavailable; retained facts may be stale";
    }
  }
  return gap;
}
