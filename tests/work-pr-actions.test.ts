import { expect, test } from "bun:test";
import { projectPRs as project } from "../scripts/lib/work/pr-actions.ts";
import type { GithubRecord } from "../scripts/lib/work/github.ts";
import { GITHUB_PARTIAL_GAP } from "../scripts/lib/work/github.ts";
import type { GithubFacts } from "../scripts/lib/work/github-facts.ts";
import type { SourceHealth, WorkRecord } from "../scripts/lib/work/types.ts";
const now = Date.parse("2026-10-21T10:00:00Z");
const projectPRs: typeof project = (records, health, view, repository, at = now) => project(records, health, view, repository, at);
const head = "a".repeat(40);
const health: SourceHealth = { source: "github", attemptedAt: "2026-10-21T10:00:00Z", succeededAt: "2026-10-21T10:00:00Z", gap: null };
function row(number = 1, facts: Partial<GithubFacts> = {}, data: Partial<GithubRecord> = {}): WorkRecord {
  const record: GithubRecord = { kind: "pr", title: `Change ${number}`, url: `https://github.com/example/repo/pull/${number}`, repository: "example/repo", number, owned: true, requested: false, hidden: false, draft: false, status: "approved", head, expectedHead: head, threadUrl: "", facts: { checkedAt: "2020-01-01T00:00:00Z", repository: "example/repo", number, headOid: head, state: "OPEN", draft: false, baseBranch: "main", headBranch: `change-${number}`, headRepository: "example/repo", viewer: "viewer", author: "viewer", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: [], checksComplete: true, ownReview: null, reviewsComplete: true, ...facts }, ...data };
  return { source: "github", key: `pr:${number}`, data: record as unknown as WorkRecord["data"], digest: "", observedAt: health.succeededAt! };
}
function action(facts: Partial<GithubFacts> = {}, data: Partial<GithubRecord> = {}, h = health) { return projectPRs([row(1, facts, data)], h, "mine").rows[0]!; }
test("should isolate unavailable PR facts without hiding verified actions in the same collection", () => {
  const records = [row(1), row(2, {}, { factsGap: "GitHub head differs from watcher expected head" })];
  const partial = { ...health, gap: GITHUB_PARTIAL_GAP };
  expect(projectPRs(records, partial, "mine").rows.map(r => r.section)).toEqual(["Ready to merge", "Status unavailable"]);
  expect(projectPRs(records, { ...partial, gap: "GitHub collection in progress" }, "mine").rows.map(r => r.section)).toEqual(["Status unavailable", "Status unavailable"]);
});
test("should require current complete GitHub gates instead of watcher approval or fact age", () => {
  expect(action().section).toBe("Ready to merge");
  for (const data of [{ facts: undefined }, { factsGap: "API failed" }, { expectedHead: "b".repeat(40) }, { expectedHead: undefined }]) expect(action({}, data).section).toBe("Status unavailable");
  for (const h of [{ ...health, gap: "gap" }, { ...health, attemptedAt: "later" }, { ...health, succeededAt: null }]) expect(action({}, {}, h).section).toBe("Status unavailable");
  for (const facts of [{ checksComplete: false }, { reviewsComplete: false }, { mergeable: "UNKNOWN" }, { mergeStateStatus: "UNKNOWN" }, { reviewDecision: "UNKNOWN" }]) expect(action(facts).section).toBe("Status unavailable");
  expect(action({ reviewDecision: "REVIEW_REQUIRED" }).reason).toBe("Review required");
  expect(action({ mergeStateStatus: "BLOCKED" }).section).toBe("Waiting");
});
test("should distinguish successful neutral skipped pending failing and unknown check results", () => {
  for (const conclusion of ["SUCCESS", "NEUTRAL", "SKIPPED"]) expect(action({ checks: [{ name: "ci", status: "COMPLETED", conclusion }] }).section).toBe("Ready to merge");
  expect(action({ checks: [{ name: "legacy", status: "SUCCESS", conclusion: null }] }).section).toBe("Ready to merge");
  for (const status of ["PENDING", "QUEUED", "IN_PROGRESS"]) expect(action({ checks: [{ name: "ci", status, conclusion: null }] }).reason).toBe("1 pending check");
  for (const status of ["FAILURE", "ERROR"]) expect(action({ checks: [{ name: "legacy", status, conclusion: null }] }).reason).toBe("1 failing check");
  expect(action({ checks: [{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" }, { name: "ci2", status: "COMPLETED", conclusion: "TIMED_OUT" }] }).reason).toBe("2 failing checks");
  expect(action({ checks: [{ name: "ci", status: "COMPLETED", conclusion: null }] }).section).toBe("Status unavailable");
});
test("should show evidenced attention drafts and exclude verified closed PRs only", () => {
  expect(action({ reviewDecision: "CHANGES_REQUESTED" }).reason).toBe("Changes requested");
  expect(action({ mergeable: "CONFLICTING" }).reason).toBe("Merge conflicts");
  expect(action({ draft: true }).section).toBe("Drafts");
  for (const state of ["CLOSED", "MERGED"]) {
    expect(projectPRs([row(1, { state })], health, "mine").rows).toEqual([]);
    expect(projectPRs([row(1, { state }, { factsGap: "failed" })], health, "mine").rows[0]!.section).toBe("Status unavailable");
  }
});
test("should classify only the viewer human review and actual reviewed head", () => {
  const review = (ownReview: GithubFacts["ownReview"], rest: Partial<GithubFacts> = {}) => projectPRs([row(1, { ownReview, ...rest }, { owned: false, requested: true })], health, "reviews").rows[0]!;
  const own = { state: "APPROVED", commitOid: head, submittedAt: health.succeededAt! };
  expect(review(null, { reviewDecision: "CHANGES_REQUESTED" }).section).toBe("Awaiting my review");
  expect(review(own).section).toBe("Reviewed");
  expect(review({ ...own, state: "CHANGES_REQUESTED" }).section).toBe("Waiting on author");
  expect(review({ ...own, commitOid: "b".repeat(40) }).reason).toBe("New commits since your review");
  expect(review({ ...own, commitOid: null }).section).toBe("Status unavailable");
  expect(review({ ...own, state: "DISMISSED", commitOid: "b".repeat(40) }).section).toBe("Awaiting my review");
  expect(review({ ...own, state: "DISMISSED", commitOid: null }).section).toBe("Awaiting my review");
  expect(review({ ...own, state: "UNKNOWN" }).section).toBe("Status unavailable");
});
test("should show each visible PR exactly once and preserve hidden ownership distinctions", () => {
  const records = [row(1, {}, { hidden: true }), row(2, {}, { owned: false, requested: true }), row(3, {}, { owned: false, requested: true, hidden: true }), row(4, {}, { owned: false })];
  for (const [view, keys] of [["mine", ["pr:1"]], ["reviews", ["pr:2"]]] as const) {
    const p = projectPRs(records, health, view);
    expect(p.rows.map(r => r.key)).toEqual([...keys]);
    expect(p.groups.flatMap(g => g.members.map(r => r.key))).toEqual([...keys]);
  }
});
test("should order dependencies using all records before view or repository filtering", () => {
  const child = row(2, { baseBranch: "change-1" });
  const parent = row(1);
  const p = projectPRs([child, parent], health, "mine");
  expect(p.groups.map(g => ({ primary: g.primary.key, section: g.section, members: g.members.map(r => [r.key, r.reason]) }))).toEqual([{ primary: "pr:1", section: "Ready to merge", members: [["pr:1", "GitHub merge requirements satisfied"], ["pr:2", "Waiting for parent PR to merge"]] }]);
  const foreignOwnedParent = row(1, {}, { owned: false });
  expect(projectPRs([child, foreignOwnedParent], health, "mine").rows[0]!.section).toBe("Waiting");
  const requestedChild = row(2, { baseBranch: "change-1" }, { owned: false, requested: true });
  expect(projectPRs([requestedChild, parent], health, "reviews").rows[0]!.section).toBe("Awaiting my review");
  expect(projectPRs([child, parent], health, "mine", "absent/repo").groups).toEqual([]);
});
test("should reject foreign fork ambiguous cyclic and incomplete stack evidence", () => {
  const child = row(2, { baseBranch: "change-1" });
  expect(projectPRs([child, row(1, { headRepository: "fork/repo" })], health, "mine").groups).toHaveLength(2);
  const ambiguous = projectPRs([child, row(1), row(3, { headBranch: "change-1" })], health, "mine");
  expect(ambiguous.rows[0]!.reason).toBe("Stack relationship unavailable");
  const cycle = projectPRs([child, row(1, { baseBranch: "change-2" })], health, "mine");
  expect(cycle.rows.map(r => r.section)).toEqual(["Status unavailable", "Status unavailable"]);
  expect(cycle.groups.flatMap(g => g.members)).toHaveLength(2);
  expect(action({ headRepository: null }).reason).toBe("Stack relationship unavailable");
  expect(projectPRs([child, row(1, {}, { factsGap: "failed" })], health, "mine").rows[0]!.section).toBe("Status unavailable");
});
test("should expose an actionable failing child without promoting a descendant merge", () => {
  const p = projectPRs([row(1, { reviewDecision: "REVIEW_REQUIRED" }), row(2, { baseBranch: "change-1", checks: [{ name: "ci", status: "FAILURE", conclusion: null }] })], health, "mine");
  expect(p.groups[0]!.primary.key).toBe("pr:2");
  expect(p.groups[0]!.section).toBe("Needs attention");
  expect(p.groups[0]!.members.map(r => r.key)).toEqual(["pr:1", "pr:2"]);
});
test("should retain cross-repository fork dependencies outside the repository scope", () => {
  const parent = row(1, { headRepository: "fork/repo" });
  const child = row(2, { repository: "fork/repo", headRepository: "fork/repo", baseBranch: "change-1" }, { repository: "fork/repo" });
  const p = projectPRs([child, parent], health, "mine", "fork/repo");
  expect(p.rows.map(r => ({ key: r.key, section: r.section, parent: r.parent }))).toEqual([{ key: "pr:2", section: "Waiting", parent: { key: "pr:1", url: "https://github.com/example/repo/pull/1", number: 1 } }]);
});

test("should classify actual collected health across watcher cadence identical facts cache expiry and failed attempts", async () => {
  const { collectGithub } = await import("../scripts/lib/work/collect.ts");
  const { WorkStore } = await import("../scripts/lib/work/store.ts");
  const store = new WorkStore(":memory:");
  const cfg = { watcherUrl: "http://127.0.0.1:1234" } as import("../scripts/lib/work/types.ts").WorkConfig;
  const data = row().data as unknown as GithubRecord;
  let poll = now;
  let fail = false;
  const collect = () => collectGithub(store, cfg, {
    now: new Date(poll),
    fetcher: async () => Response.json({ ok: true, lastError: null, lastSuccessfulPoll: new Date(poll - 60_000).toISOString(), myPullRequests: [{ key: "pr:1", ...data }], queue: [], hidden: [] }),
    githubCommand: async () => {
      // Exercise the actual intermediate health rather than assuming attemptedAt means success.
      expect(projectPRs(store.records("github"), store.health("github"), "mine", null, poll).rows.every(r => r.section === "Status unavailable")).toBe(true);
      if (fail) throw new Error("offline");
      return { data: { viewer: { login: "viewer" }, p0: { pullRequest: {
        number: 1, repository: { nameWithOwner: "example/repo" }, author: { login: "viewer" }, headRefOid: head, state: "OPEN", isDraft: false, baseRefName: "main", headRefName: "change-1", headRepository: { nameWithOwner: "example/repo" }, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null,
        commits: { nodes: [{ commit: { oid: head, statusCheckRollup: null } }] }, reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
      } } } };
    },
  });
  try {
    await collect();
    const first = store.health("github");
    expect(first.attemptedAt).not.toBe(first.succeededAt);
    expect(projectPRs(store.records("github"), first, "mine").rows[0]!.section).toBe("Ready to merge");
    const seq = store.latestSeq();
    const checkedAt = (store.records("github")[0]!.data as unknown as GithubRecord).facts!.checkedAt;
    poll += 20 * 60_000;
    await collect();
    expect((store.records("github")[0]!.data as unknown as GithubRecord).facts!.checkedAt).toBe(checkedAt);
    expect(store.latestSeq()).toBe(seq);
    const latest = store.health("github");
    expect(projectPRs(store.records("github"), latest, "mine", null, poll).rows[0]!.section).toBe("Ready to merge");
    for (const at of [poll + 16 * 60_000, poll - 2 * 60_000]) expect(projectPRs(store.records("github"), latest, "mine", null, at).rows[0]!.section).toBe("Status unavailable");
    // A freshly served attempt cannot rescue expired upstream discovery evidence.
    expect(projectPRs(store.records("github"), { ...latest, succeededAt: new Date(poll - 16 * 60_000).toISOString() }, "mine", null, poll).rows[0]!.section).toBe("Status unavailable");
    fail = true;
    poll += 60_000;
    await collect();
    expect(projectPRs(store.records("github"), store.health("github"), "mine", null, poll).rows[0]!.section).toBe("Status unavailable");
  } finally { store.close(); }
});

test("should terminate cycles with descendants and preserve every stack member once", () => {
  const p = projectPRs([row(3, { baseBranch: "change-2" }), row(2, { baseBranch: "change-1" }), row(1, { baseBranch: "change-2" })], health, "mine");
  expect(p.rows.map(r => r.reason)).toEqual(Array(3).fill("Stack relationship unavailable"));
  expect(p.groups.flatMap(g => g.members.map(r => r.key)).sort()).toEqual(["pr:1", "pr:2", "pr:3"]);
  expect(action({ reviewDecision: null }).section).toBe("Ready to merge");
});

test("should filter snoozed members after resolving parents and recompute groups without duplicates", async () => {
  const { visiblePRs } = await import("../scripts/lib/work/pr-actions.ts");
  const all = projectPRs([row(1), row(2, { baseBranch: "change-1" }), row(3)], health, "mine");
  const snoozes = [{ key: "pr:1", version: 1, until: now + 1000, durationHours: 1 as const }];
  const p = visiblePRs(all, snoozes, false, now);
  expect(p.rows.map(r => r.key)).toEqual(["pr:2", "pr:3"]);
  expect(p.rows[0]).toMatchObject({ section: "Waiting", parent: { key: "pr:1" } });
  expect(p.groups[0]).toMatchObject({ primary: { key: "pr:2" }, section: "Waiting" });
  expect(p.groups.flatMap(g => g.members.map(r => r.key))).toEqual(p.rows.map(r => r.key));
  expect(visiblePRs(all, snoozes, true, now).rows).toHaveLength(3);
  expect(visiblePRs(all, snoozes, false, now + 1000).rows).toHaveLength(3);
  expect(visiblePRs(all, [{ ...snoozes[0]!, until: null }], false, now).rows).toHaveLength(3);
});
