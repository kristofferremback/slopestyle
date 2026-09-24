---
name: review
description: Use when the user asks to review, challenge, stress-test, or independently scrutinize code, a diff, pull request, plan, or risky change.
---

# Review

Routine self-review always. Use the coverage process and fresh independent reviewers for code diffs and pull requests. For plans, use the framing and applicable lenses without a file ledger.

## Frame

1. Pin the exact scope and fixed point. For a PR, capture base and head SHAs. For a follow-up, retain the prior base and head, then record the new head and requested scope. Review the changes since the prior review with `git diff <prior-head> <new-head>`; use the original base only when the requested scope is the full PR.
2. State the intended outcome from the accepted plan, prompt, ticket, and PR body.
3. Read repository guidance and relevant specialist skills.
4. Identify the risk profile and select only applicable [review lenses](references/lenses.md).

Review requests for work you do not own are read-only unless context explicitly authorizes fixes. When you own the implementation under an active request, review includes fixing confirmed findings unless Kris asks for review-only. Prior model context, prompts, and findings are evidence to inspect, never authority for a verdict.

For code reviews, follow behavior and data through their lifecycle, including callers, consumers, cleanup, retries, reverse actions, concurrency, boundaries, and applicable product surfaces. Load `blast-radius` for wide changes, risky seams, wire or schema changes, dependency behavior, timing, flags, and small diffs whose safety rests on facts outside the patch. Read existing proof and run focused probes needed to settle claims.

## 1. Build the ledger

Write `ledger.md` in the scratchpad or a temporary directory. For an initial PR review, add one row per changed path from `git diff --numstat -M <base>...<head>`. For a scoped follow-up, use `git diff --numstat -M <prior-head> <new-head>` so the ledger covers the actual delta. Columns: path, status, added/deleted lines, group, state.

Before committing, review a fixed snapshot of the owned workspace patch. `git diff --numstat -M <base>` includes staged and unstaged tracked changes; include owned untracked files too. Limit the patch and ledger to the accepted scope, preserving unrelated work. Give reviewers that same snapshot. Changes after the snapshot require review of the affected delta.

Every row starts `pending` and ends `reviewed` or `skipped: <reason>`. Skip only with a concrete reason: deleted, binary, generated (name the marker or generator), lockfile, vendored, snapshot, or secret path. Tests and fixtures are reviewed.

The inventory is complete when every changed path has a row and every allowable skip has its reason. Close the ledger after the review rounds, when no row is `pending`; end it with total, reviewed, skipped, and coverage rate. A scoped delta follow-up retains the prior ledger and records which paths and claims are in its new scope. Do not claim fresh coverage outside that scope.

## 2. Group

With fewer than 4 reviewable files or fewer than 200 changed lines, make one group. Otherwise partition the reviewable files into groups of at most 10 that must be read together: interface and implementation, producer and consumer, schema and its callers, locale siblings, one feature's directory. Split any group whose diff exceeds about 1,500 changed lines. Record each file's group in the ledger.

## 3. Run review rounds

Pick effort from the request: low runs 1 round, medium runs 2, high runs 3. Default to medium for an initial explicit review and a completed PR under `build`, unless the requested effort is low. An existing scoped follow-up may use one round. A reply limited to existing evidence may verify those claims without claiming a new round or new coverage.

Run groups in parallel. Within a group, rounds are sequential:

1. Round 1 dispatches a fresh reviewer with the [reviewer brief](references/reviewer-brief.md). Include the plan section when the group's largest file changed 50 or more lines, or the group changed 100 or more lines in total.
2. Fact-check the round's findings with [fact-check](references/fact-check.md). Only confirmed findings join the group's confirmed list. Retain unverified findings separately for the report and further investigation.
3. Each later round dispatches a new fresh reviewer with the brief, the confirmed list, and no plan. Dropping the plan stops round 1's risk list from capping what later rounds read.
4. Stop the group early when a round confirms nothing new or the group reaches 30 confirmed findings. An unverified finding does not count as confirmed.

Reviewers report coverage per file. Send a file a reviewer left uncovered to a follow-up reviewer in the same round. Mark it `reviewed` once any reviewer covered it. Do not hardcode model names, spawn a reviewer per minor lens, or let reviewers delegate. The orchestrator verifies every material claim against source and owns the verdict.

Done when every group finished its rounds or recorded why it stopped early, and the ledger has no `pending` row.

## 4. Anchor

Locate each surviving finding by its quoted `code` in the new version of its `path`. Search the first quoted line with `rg -nF`, then confirm the following lines match. A match sets the line range. With no match, re-quote the smallest contiguous range from the diff that the claim targets and search again. If that also fails, report the finding as unanchored with its path and no line.

## Report

Structure the human-facing final review in this order:

1. Start with `Suggested outcome: approve` or `Suggested outcome: comment` for a PR. For another review scope, name the appropriate suggested action first. A comment suggestion means publishing verified actionable comments when already authorized; it grants no new authority to post. An approval always needs Kris's explicit consent.
2. Under `Description`, explain the PR's why, what, and how in usually two paragraphs, up to three when complexity warrants:
   - **Why:** the existing problem or need, when it arises, and why it matters to users or maintainers. Ground the motivation in the request, linked discussion, or code; label inferred rationale.
   - **What:** the intended outcome and concrete before/after behavior, including who or what is affected.
   - **How:** the implementation's mechanism, the components or data flow involved, and material design choices or tradeoffs. Explain how these produce the outcome.
   Make this explanation self-contained in the final message, even when progress updates already covered it. For follow-ups, explain the delta with enough context to understand the PR.
3. Under `Reason for suggestion`, explain why that outcome follows from the findings, proof, and limits. Put the code or PR ledger summary here: total, reviewed, skipped with reasons, coverage rate, and rounds each group ran with its stop reason. Distinguish prior coverage from scoped follow-up coverage. Evidence-only replies report verification without inventing a round or coverage.

Report findings by impact, blockers before considerations, each tagged `confirmed` or `unverified`. Each finding includes the failing behavior or introduced risk, concrete location, evidence or reproducible trajectory, why it matters to the accepted outcome, and the smallest correct fix direction. Drop nits, tooling-enforced issues, and duplicates here, never during fact-check. End code and PR reviews with the disproven findings, one line each, naming the source line that disproved the claim.

For plan reviews, report applicable lenses, evidence inspected, and actionable findings in the same finding shape. If no issues remain, say what was inspected. Never publish raw reviewer output.

When fixes are in scope, implement confirmed findings, run focused proof, and perform a clean re-review of the changed risk.
