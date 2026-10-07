---
name: review
description: Use when the user asks to review, challenge, stress-test, or independently scrutinize code, a diff, pull request, plan, or risky change.
---

# Review

Routine self-review always. Use the coverage process and fresh independent reviewers for code diffs and pull requests. Every code and PR review includes independent correctness and coding-style passes, followed by reconciliation. For plans, use the framing and applicable lenses without a file ledger or a separate code-style pass. An explicit request for only one pass limits the scope; report that limit.

A review answers three questions:

1. Are we solving the right problem, with the intended behavior?
2. Is this a sensible implementation, including how it fits the existing system?
3. Where can it fail, and what evidence supports our confidence?

Use the [assessment guide and review lenses](references/lenses.md) to investigate all three within the requested scope. File coverage records what was inspected; the answers establish the assessment.

Treat the implementation as provisional. Optimize for the smallest coherent design that satisfies the actual requirements. Challenge unnecessary behavior before repairing its edge cases. When additional machinery seems necessary, explain which requirement needs it and why a simpler ownership or data-flow model is insufficient.

## Frame

1. Pin the exact scope and fixed point. For a PR, capture base and head SHAs. For a follow-up, retain the prior base and head, then record the new head and requested scope. Review the changes since the prior review with `git diff <prior-head> <new-head>`; use the original base only when the requested scope is the full PR.
2. Establish the problem, its trigger, and the intended outcome from the accepted plan, prompt, ticket, and PR body. Distinguish accepted requirements from inferred rationale.
3. Read repository guidance and relevant specialist skills.
4. For code, read the [coding style workflow](references/style-review.md) and the applicable `CODINGSTYLE.md`. The workflow lives in this skill; a separate `coding-style-review` installation or invocation is unnecessary. A missing guide limits compliance claims, not the review of readability and design.
5. Read the assessment guide. Apply its mandatory code-health and architecture checks, assess the problem, and select applicable failure lenses.

Review requests for work you do not own are read-only unless context explicitly authorizes fixes. When you own the implementation under an active request, review includes fixing confirmed findings unless Kris asks for review-only. Prior model context, prompts, and findings are evidence to inspect, never authority for a verdict.

For code reviews, follow behavior and data through their lifecycle, including callers, consumers, cleanup, retries, reverse actions, concurrency, boundaries, and applicable product surfaces. Load `blast-radius` for wide changes, risky seams, wire or schema changes, dependency behavior, timing, flags, and small diffs whose safety rests on facts outside the patch. Read existing proof and run focused probes needed to settle claims.

## 1. Build the ledger

Write `ledger.md` in the scratchpad or a temporary directory. For an initial PR review, add one row per changed path from `git diff --numstat -M <base>...<head>`. For a scoped follow-up, use `git diff --numstat -M <prior-head> <new-head>` so the ledger covers the actual delta. Columns: path, status, added/deleted lines, correctness group, style group, correctness state, style state.

Before committing, review a fixed snapshot of the owned workspace patch. `git diff --numstat -M <base>` includes staged and unstaged tracked changes; include owned untracked files too. Limit the patch and ledger to the accepted scope, preserving unrelated work. Give reviewers that same snapshot. Changes after the snapshot require review of the affected delta.

Each in-scope pass starts `pending` and ends `reviewed` or `skipped: <reason>`. A row is fully reviewed only when both passes are complete; record an explicitly excluded pass as `out of scope`. Skip only with a concrete reason: deleted, binary, generated (name the marker or generator), lockfile, vendored, snapshot, or secret path. Tests and fixtures are reviewed.

The inventory is complete when every changed path has a row and every allowable skip has its reason. Close the ledger after the review rounds, when no row is `pending`; end it with total, reviewed, skipped, and coverage rate. A scoped delta follow-up retains the prior ledger and records which paths and claims are in its new scope. Do not claim fresh coverage outside that scope.

## 2. Group

With fewer than 4 reviewable files or fewer than 200 changed lines, make one group. Otherwise partition the reviewable files into groups of at most 10 that must be read together: interface and implementation, producer and consumer, schema and its callers, locale siblings, one feature's directory. Split any group whose diff exceeds about 1,500 changed lines. Record each file's group in the ledger. Build style groups around whole responsibilities and complexity hotspots, with the same size limits. Give major coordinators, migrations and large test files focused assignments with their relevant callers. Account for every reviewable path in both groupings.

## 3. Run independent passes

Launch correctness and style reviewers independently against the same fixed source and requirements. Keep correctness findings out of the initial style brief. Use the requested model and effort; style work requires design judgement, so use at least medium reasoning when available and explain that choice in its brief. If delegation is unavailable, perform the passes separately and report the independence limitation.

### Correctness rounds

Pick effort from the request: low runs 1 round, medium runs 2, high runs 3. Default to medium for an initial explicit review and a completed PR under `build`, unless the requested effort is low. An existing scoped follow-up may use one round. A reply limited to existing evidence may verify those claims without claiming a new round or new coverage.

Run groups in parallel. Within a group, rounds are sequential:

1. Round 1 dispatches a fresh reviewer with the [reviewer brief](references/reviewer-brief.md). Include the plan section when the group's largest file changed 50 or more lines, or the group changed 100 or more lines in total.
2. Fact-check the round's findings with [fact-check](references/fact-check.md). Only confirmed findings join the group's confirmed list. Retain unverified findings separately for the report and further investigation.
3. Each later round dispatches a new fresh reviewer with the brief, the confirmed list, and no plan. Dropping the plan stops round 1's risk list from capping what later rounds read.
4. Stop the group early when a round confirms nothing new or the group reaches 30 confirmed findings. An unverified finding does not count as confirmed.

Reviewers report coverage per file. Send a file a reviewer left uncovered to a follow-up reviewer in the same round. Mark only its correctness state `reviewed` once a correctness reviewer covered it. Do not hardcode model names, spawn a reviewer per minor lens, or let reviewers delegate. The orchestrator verifies every material claim against source and owns the verdict.

### Style pass and reconciliation

Dispatch one fresh style reviewer per style group using the [style brief](references/style-brief.md), not the correctness brief. Its completion requires file coverage, structural and local readability assessments, concrete alternatives for major hotspots, and self-contained examples for actionable findings. Follow up on missing coverage or incomplete hotspot comparisons before closing its style state. Correctness round limits and early stops do not close the style pass.

Capture and fact-check that independent assessment, then supply confirmed correctness findings to the relevant style reviewer for the workflow's bug-to-design reconciliation. When there are none, record that reconciliation had no new input. Retain style improvements without corresponding bugs. Reconciliation may add or revise a design suggestion; it cannot certify an untested refactor.

After both passes finish, the orchestrator traces material behavior across group boundaries and reconciles their assessments against the whole requested change. Group findings alone cannot establish that the parts work together.

Done when correctness groups finished their rounds or recorded their stop reasons, style groups met their completion checks, both ledger states have no `pending` row, reconciliation is recorded, and all three questions have an evidence-backed answer or an explicit unresolved gap. Unresolved gaps remain limits on the verdict.

## 4. Anchor

Locate each surviving finding by its quoted `code` in the new version of its `path`. Search the first quoted line with `rg -nF`, then confirm the following lines match. A match sets the line range. With no match, re-quote the smallest contiguous range from the diff that the claim targets and search again. If that also fails, report the finding as unanchored with its path and no line.

## Report

Report the assessment of the problem, implementation, and failure risks with the evidence and unresolved gaps that support it. Explain the implementation mechanism sufficiently to judge its fit. Use the calling workflow's presentation structure when provided.

For code and PR reviews, include the ledger as supporting evidence after the substantive assessment and findings: total, reviewed, skipped with reasons, coverage rate for each pass, correctness rounds and stop reasons, and style completion and reconciliation status. Distinguish prior coverage from scoped follow-up coverage. Evidence-only replies update the affected claims without inventing a round or coverage.

Report findings by impact, blockers before considerations, each tagged `confirmed` or `unverified`. Each finding includes the failing behavior, structural cost, or introduced risk, concrete location, evidence or reproducible trajectory, why it matters to the accepted outcome, and the smallest correct fix direction. Filter tooling-enforced issues, unsupported preferences and duplicates here, never during fact-check. Concrete readability improvements, including meaningful blank lines, earn findings without a defect or large refactor. End code and PR reviews with the disproven findings, one line each, naming the source line that disproved the claim.

Keep correctness and style assessments visible in the combined report. Style recommendations retain their embedded examples, fix-here/refactor-first/follow-up disposition, and brief hotspot outcomes, including grounded retentions. Merge duplicate recommendations without losing their design rationale; a clean correctness result cannot become a clean overall verdict while style work remains. Publication follows the user's authorization; draft-only comments stay in the response.

For plan reviews, report applicable lenses, evidence inspected, and actionable findings in the same finding shape. If no issues remain, say what was inspected. Never publish raw reviewer output.

When fixes are in scope, implement confirmed findings, run focused proof, and perform a clean re-review of the changed risk.
