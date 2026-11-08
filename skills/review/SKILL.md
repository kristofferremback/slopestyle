---
name: review
description: Use when the user asks to review, challenge, stress-test, or independently scrutinize code, a diff, pull request, plan, or risky change.
---

# Review

Routine self-review always. Use the coverage process and fresh independent reviewers for code diffs and pull requests. Every code and PR review includes an independent correctness pass and a capped coding-style pass, followed by reconciliation. For plans, use the framing and applicable lenses without a file ledger or a separate code-style pass. An explicit request for only one pass limits the scope; report that limit.

A finding blocks when it is **proved** and breaks the accepted outcome once the change runs as intended. Traced findings in a few risk classes block as decisions for Kris; [fact-check](references/fact-check.md) owns those outcomes. Reviews spend their effort breaking the change at the real code, and the report keeps reasoning-only claims visible without turning them into work.

A review answers three questions:

1. Are we solving the right problem, with the intended behavior?
2. Is this a sensible implementation, including how it fits the existing system?
3. Where can it fail, and what evidence supports our confidence?

Use the [assessment guide and review lenses](references/lenses.md) to investigate all three within the requested scope. File coverage records what was inspected; the answers establish the assessment.

## Frame

1. Pin the exact scope and fixed point. For a PR, capture base and head SHAs. For a follow-up, retain the prior base and head, then record the new head and requested scope. Review the changes since the prior review with `git diff <prior-head> <new-head>`; use the original base only when the requested scope is the full PR.
2. Establish the problem, its trigger, and the intended outcome from the accepted plan, prompt, ticket, and PR body. Distinguish accepted requirements from inferred rationale: a producer storing a value or a read-only helper reconstructing it establishes current behavior, not the intended write contract.
3. Read repository guidance and relevant specialist skills.
4. For code, read the [coding style workflow](references/style-review.md) and the applicable `CODINGSTYLE.md`. The workflow lives in this skill; a separate `coding-style-review` installation or invocation is unnecessary. A missing guide limits compliance claims, not the review of readability and design.
5. Read the assessment guide. Apply its mandatory code-health and architecture checks, assess the problem, and select applicable failure lenses.

Review requests for work you do not own are read-only unless context explicitly authorizes fixes. When you own the implementation under an active request, review includes the fix loop below unless Kris asks for review-only. Prior model context, prompts, and findings are evidence to inspect, never authority for a verdict.

For code reviews, follow behavior and data through their lifecycle, including callers, consumers, cleanup, retries, reverse actions, concurrency, boundaries, and applicable product surfaces. Load `blast-radius` for wide changes, risky seams, wire or schema changes, dependency behavior, timing, flags, and small diffs whose safety rests on facts outside the patch. Read existing proof and run focused probes needed to settle claims.

For plans, list the open questions a prototype or probe can settle and settle them with `prototype` before judging the design. Raise risks the accepted design makes reachable; a plan review that finds none says so.

## 1. Build the ledger

Write `ledger.md` in the scratchpad or a temporary directory. For an initial PR review, add one row per changed path from `git diff --numstat -M <base>...<head>`. For a scoped follow-up, use `git diff --numstat -M <prior-head> <new-head>` so the ledger covers the actual delta. Columns: path, status, added/deleted lines, correctness group, style group, correctness state, style state.

Before committing, review a fixed snapshot of the owned workspace patch. `git diff --numstat -M <base>` includes staged and unstaged tracked changes; include owned untracked files too. Limit the patch and ledger to the accepted scope, preserving unrelated work. Give reviewers that same snapshot. Changes after the snapshot require review of the affected delta.

Each in-scope pass starts `pending` and ends `reviewed` or `skipped: <reason>`. A row is fully reviewed only when both passes are complete; record an explicitly excluded pass as `out of scope`. Skip only with a concrete reason: deleted, binary, generated (name the marker or generator), lockfile, vendored, snapshot, or secret path. Tests and fixtures are reviewed.

The inventory is complete when every changed path has a row and every allowable skip has its reason. Close the ledger after the review passes, when no row is `pending`; end it with total, reviewed, skipped, and coverage rate. A scoped delta follow-up retains the prior ledger and records which paths and claims are in its new scope. Do not claim fresh coverage outside that scope.

## 2. Group

With fewer than 4 reviewable files or fewer than 200 changed lines, make one group. Otherwise partition the reviewable files into groups of at most 10 that must be read together: interface and implementation, producer and consumer, schema and its callers, locale siblings, one feature's directory. Split any group whose diff exceeds about 1,500 changed lines. Record each file's group in the ledger. Build style groups around whole responsibilities and complexity hotspots, with the same size limits. Give major coordinators, migrations and large test files focused assignments with their relevant callers. Account for every reviewable path in both groupings. Each brief separates assigned files and hotspots from supporting context; send only that group's hotspots. Findings outside an assignment are leads for the coordinator to route to the owning group, not a reason to expand the assignment or claim its coverage.

## 3. Run independent passes

Launch correctness and style reviewers independently against the same fixed source and requirements. Keep correctness findings out of the initial style brief. Use the requested model and effort; style work requires design judgement, so use at least medium reasoning when available and explain that choice in its brief. If delegation is unavailable, perform the passes separately and report the independence limitation.

### Correctness pass

Run one round per group, in parallel:

1. Give each reviewer that writes repros its own worktree at the fixed head, plus the uncommitted snapshot when one is under review. Use `git worktree add`, or the harness's checkout isolation when it owns checkouts. Reviewers that only read may share one worktree. Remove the worktrees after the round.
2. Dispatch a fresh reviewer, never a fork of your own context, with the [reviewer brief](references/reviewer-brief.md). The reviewer tries to break the change and runs what it claims, following `test` for radius and the heavy-command guard.
3. Fact-check the round's findings with [fact-check](references/fact-check.md).

A later full round runs only when the change gains new behavior, a redesign, or a large new diff. A rebase, conflict resolution, or fix delta gets one fresh verifier that reruns the affected findings' commands and probes the delta at the new head.

Reviewers report coverage per file. Send a file a reviewer left uncovered to a follow-up reviewer in the same round. Mark only its correctness state `reviewed` once a correctness reviewer covered it. Do not hardcode model names, spawn a reviewer per minor lens, or let reviewers delegate. The orchestrator reruns every proved finding's command and owns the verdict.

### Style pass and reconciliation

Dispatch one fresh style reviewer per style group using the [style brief](references/style-brief.md), not the correctness brief. Its completion requires file coverage, structural and local readability assessments, concrete alternatives for major hotspots, and self-contained examples for actionable findings. Check returned coverage against the assignment and route any cross-group leads. Follow up on missing coverage or incomplete hotspot comparisons before closing its style state.

The review reports at most five style findings, ranked by the reading or maintenance cost they remove. Each names the weak pattern it stops from spreading or the future edit it makes cheaper; fewer than five is usual, and zero is a complete result. Rank first new code that repeats a weak pattern already present in the codebase, since agents copy what they see. Keep the rest in the style assessment as one line each. A style finding that a lint rule, type, or formatter could enforce moves to the report's constraint candidates.

Capture and fact-check that independent assessment, then supply proved correctness findings to the relevant style reviewer for the workflow's bug-to-design reconciliation. When there are none, record that reconciliation had no new input. Retain style improvements without corresponding bugs. Reconciliation may add or revise a design suggestion; it cannot certify an untested refactor.

After both passes finish, the orchestrator traces material behavior across group boundaries and reconciles their assessments against the whole requested change. Carry forward each material risk raised in the plans or reports, including risks outside the finding lists. Settle cheap, reachable cases with focused probes; classify the evidence with [fact-check](references/fact-check.md) and retain each unresolved behavior and its missing evidence in the assessment. Group findings alone cannot establish that the parts work together.

Done when every correctness group finished its round, style groups met their completion checks, both ledger states have no `pending` row, reconciliation is recorded, and all three questions have an evidence-backed answer or an explicit unresolved gap. Unresolved gaps remain limits on the verdict.

## 4. Anchor

Locate each surviving finding by its quoted `code` in the new version of its `path`. Search the first quoted line with `rg -nF`, then confirm the following lines match. A match sets the line range. With no match, re-quote the smallest contiguous range from the diff that the claim targets and search again. If that also fails, report the finding as unanchored with its path and no line.

## Report

Write the report for Kris reading on a phone. It opens with the verdict: the blocker count, what was run to reach it, and any material unresolved behavior. An empty blocker list is a valid result; when a material behavior remains unverified, state that the review is inconclusive for that behavior. File coverage establishes inspection, not behavioral assurance.

Then, in this order:

1. **Blockers:** proved findings whose impact reaches the accepted outcome once the change runs as intended, including behind its flag. Each gives the command, its output, and the output the intent requires. Then traced findings in the risk classes [fact-check](references/fact-check.md) names, as decisions for Kris.
2. **Considerations:** at most three architecture findings and at most five style findings, per the caps above and in the assessment guide, plus proved findings with trivial impact, such as a cosmetic rebuild or a stale comment.
3. **Assessment:** a few sentences per question on the problem, the implementation mechanism and its fit, and the failure risks, with the evidence and unresolved gaps behind each.

Each finding is one short paragraph: location, what fails or what it costs, the evidence, why it matters to the accepted outcome, and the smallest correct fix direction. Correctness findings carry a code example only when the fix is unclear from that paragraph; retained style findings keep the worksheet's example. Filter tooling-enforced issues, unsupported preferences and duplicates here, never during fact-check.

An appendix follows, or a linked file when the harness delivers files:

- **Unproved:** remaining traced and unverified findings, one line each with the missing evidence. These inform; they leave the code as it is.
- **Constraint candidates:** each style finding a machine could enforce, with the lint rule, type, or guidance line that would make it impossible, and each proved bug's regression test.
- **Disproven:** each claim with the evidence that disproved it, one line each.
- **Ledger:** total, reviewed, skipped with reasons, coverage rate for each pass, rounds run and why, style completion and reconciliation status, and brief hotspot outcomes. Distinguish prior coverage from scoped follow-up coverage. Evidence-only replies update the affected claims without inventing a round or coverage.

Use the calling workflow's presentation structure when provided. Before delivering any code review, the coordinator runs the worksheet's [final-comment check](references/style-worksheet.md#final-comment-check) against the actual user-visible draft, including code inside details blocks. The review is complete only when retained style findings survive synthesis as self-contained comments with readable examples; a linked report does not discharge this check. Publication follows the user's authorization; draft-only comments stay in the response.

For plan reviews, report the questions settled by probes, applicable lenses, evidence inspected, and actionable findings in the same finding shape. If no issues remain, say what was inspected. Never publish raw reviewer output.

When fixes are in scope, settle each finding with [fix disposition](references/fix-disposition.md), implement the in-scope decisions, run focused proof, and verify the fix delta as the correctness pass describes.
