import { GITHUB_MAX_AGE_MS, GITHUB_PARTIAL_GAP, type GithubRecord } from "./github.ts";
import type { PRSnooze, SourceHealth, WorkRecord } from "./types.ts";

export type PRView = "mine" | "reviews";
export const actionSections = ["Needs attention", "Ready to merge", "Awaiting my review", "Changed since my review", "Waiting on author", "Waiting", "Reviewed", "Drafts", "Status unavailable"] as const;
export type PRSection = typeof actionSections[number];
export interface PRAction {
  key: string;
  record: GithubRecord;
  section: PRSection;
  reason: string;
  parent?: { key: string; url: string; number: number };
}
export interface PRGroup {
  key: string;
  section: PRSection;
  primary: PRAction;
  members: PRAction[];
}
export interface PRProjection { rows: PRAction[]; groups: PRGroup[] }

export function githubHealthCurrent(health: SourceHealth, now = Date.now()): boolean {
  const attempted = Date.parse(health.attemptedAt ?? "");
  const succeeded = Date.parse(health.succeededAt ?? "");
  return (!health.gap || health.gap === GITHUB_PARTIAL_GAP) && succeeded <= attempted + 60_000 && [attempted, succeeded].every(at => Number.isFinite(at) && at <= now + 60_000 && now - at <= GITHUB_MAX_AGE_MS);
}
function current(row: GithubRecord, health: SourceHealth, now: number): boolean {
  const f = row.facts;
  // checkedAt is retained when identical facts are reverified. Health owns freshness.
  return Boolean(githubHealthCurrent(health, now) && !row.factsGap && f && f.repository.toLowerCase() === row.repository.toLowerCase() && f.number === row.number && row.expectedHead && /^[a-f0-9]{40}$/.test(row.expectedHead) && f.headOid === row.expectedHead);
}
function classify(key: string, record: GithubRecord, health: SourceHealth, view: PRView, now: number): PRAction {
  const result = (section: PRSection, reason: string): PRAction => ({ key, record, section, reason });
  if (!current(record, health, now)) return result("Status unavailable", "Current GitHub status unavailable");
  const f = record.facts!;
  if (f.state !== "OPEN") return result("Status unavailable", "PR state unavailable");
  if (f.draft) return result("Drafts", "Draft");
  if (!f.reviewsComplete) return result("Status unavailable", "Review status incomplete");
  if (view === "reviews") {
    const review = f.ownReview;
    if (review && !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) return result("Status unavailable", "Review result unavailable");
    if (review && review.state !== "DISMISSED" && !review.commitOid) return result("Status unavailable", "Reviewed commit unavailable");
    if (review && review.state !== "DISMISSED" && review.commitOid !== f.headOid) return result("Changed since my review", "New commits since your review");
    if (review?.state === "CHANGES_REQUESTED") return result("Waiting on author", "You requested changes");
    if (review?.state === "APPROVED") return result("Reviewed", "You approved this head");
    return result("Awaiting my review", "Review requested");
  }
  const failed = f.checks.filter(c => (["FAILURE", "ERROR"].includes(c.status) || c.status === "COMPLETED" && ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"].includes(c.conclusion ?? ""))).length;
  if (failed) return result("Needs attention", `${failed} failing check${failed === 1 ? "" : "s"}`);
  if (f.reviewDecision === "CHANGES_REQUESTED") return result("Needs attention", "Changes requested");
  if (f.mergeable === "CONFLICTING" || f.mergeStateStatus === "DIRTY") return result("Needs attention", "Merge conflicts");
  if (!f.checksComplete) return result("Status unavailable", "Check status incomplete");
  const pending = f.checks.filter(c => ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"].includes(c.status)).length;
  if (pending) return result("Waiting", `${pending} pending check${pending === 1 ? "" : "s"}`);
  if (f.checks.some(c => c.status !== "SUCCESS" && (c.status !== "COMPLETED" || !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion ?? "")))) return result("Status unavailable", "Check result unavailable");
  if (f.reviewDecision === "REVIEW_REQUIRED") return result("Waiting", "Review required");
  if (f.mergeStateStatus === "BLOCKED") return result("Waiting", "GitHub merge requirements pending");
  if (f.mergeable === "MERGEABLE" && f.mergeStateStatus === "CLEAN" && [null, "APPROVED"].includes(f.reviewDecision)) return result("Ready to merge", "GitHub merge requirements satisfied");
  return result("Status unavailable", "Merge status unavailable");
}

// Relationships use the full discovered dataset, never the selected view or repository.
export function projectPRs(records: WorkRecord[], health: SourceHealth, view: PRView, repository?: string | null, now = Date.now()): PRProjection {
  const all = records.map(r => ({ key: r.key, record: r.data as unknown as GithubRecord }));
  const open = all.filter(r => !(current(r.record, health, now) && ["MERGED", "CLOSED"].includes(r.record.facts!.state)));
  const parents = new Map<string, string>();
  const uncertain = new Set<string>();
  for (const child of open) {
    if (!current(child.record, health, now)) continue;
    const f = child.record.facts!;
    if (!f.baseBranch || !f.headBranch || !f.headRepository) { uncertain.add(child.key); continue; }
    const candidates = open.filter(p => p.key !== child.key && p.record.facts && p.record.facts!.headRepository?.toLowerCase() === f.repository.toLowerCase() && p.record.facts!.headBranch === f.baseBranch);
    if (candidates.length === 1 && current(candidates[0]!.record, health, now)) parents.set(child.key, candidates[0]!.key);
    else if (candidates.length) uncertain.add(child.key);
  }
  for (const row of open) {
    const path = new Set<string>();
    let key: string | undefined = row.key;
    while (key) {
      if (path.has(key)) { for (const member of path) uncertain.add(member); break; }
      path.add(key);
      key = parents.get(key);
    }
  }
  // An ambiguous ancestor makes the whole descendant path uncertain.
  for (const row of open) {
    let key: string | undefined = row.key;
    const seen = new Set<string>();
    while (key && !seen.has(key)) {
      seen.add(key);
      if (uncertain.has(key)) { uncertain.add(row.key); break; }
      key = parents.get(key);
    }
  }
  const byKey = new Map(open.map(r => [r.key, r.record]));
  const rows = open.filter(({ record: r }) => (view === "mine" ? r.owned : r.requested && !r.owned && !r.hidden) && (!repository || r.repository === repository)).map(({ key, record }) => {
    const row = classify(key, record, health, view, now);
    const parentKey = parents.get(key);
    const parent = parentKey ? byKey.get(parentKey) : undefined;
    if (parent && !uncertain.has(key)) row.parent = { key: parentKey!, url: parent.url, number: parent.number };
    if (uncertain.has(key)) return { ...row, section: "Status unavailable" as const, reason: "Stack relationship unavailable" };
    if (view === "mine" && parents.has(key) && row.section === "Ready to merge") return { ...row, section: "Waiting" as const, reason: "Waiting for parent PR to merge" };
    return row;
  });
  const root = (key: string): string => {
    if (uncertain.has(key)) return key;
    while (parents.has(key)) key = parents.get(key)!;
    return key;
  };
  const buckets = new Map<string, PRAction[]>();
  for (const row of rows) {
    const key = root(row.key);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const depth = (key: string): number => { let n = 0; while (parents.has(key)) { n++; key = parents.get(key)!; } return n; };
  const groups = [...buckets].map(([key, members]) => {
    if (!uncertain.has(key)) members.sort((a, b) => depth(a.key) - depth(b.key));
    // In review view each requested member remains reviewable, including children.
    const primary = view === "reviews" ? members.find(r => ["Awaiting my review", "Changed since my review"].includes(r.section)) ?? members[0]! : members.find(r => r.section === "Needs attention") ?? members[0]!;
    return { key: `stack:${key}`, section: primary.section, primary, members };
  });
  return { rows, groups };
}

// Filter only after full-dataset dependency resolution; preserve parent evidence.
export function visiblePRs(projection: PRProjection, snoozes: PRSnooze[], showSnoozed = false, now = Date.now()): PRProjection {
  const hidden = new Set(snoozes.filter(s => s.until !== null && s.until > now).map(s => s.key));
  const rows = projection.rows.filter(r => showSnoozed || !hidden.has(r.key));
  const visible = new Set(rows.map(r => r.key));
  const groups = projection.groups.flatMap(group => {
    const members = group.members.filter(r => visible.has(r.key));
    if (!members.length) return [];
    const primary = members.includes(group.primary) ? group.primary : members.find(r => ["Needs attention", "Awaiting my review", "Changed since my review"].includes(r.section)) ?? members[0]!;
    return [{ ...group, members, primary, section: primary.section }];
  });
  return { rows, groups };
}
