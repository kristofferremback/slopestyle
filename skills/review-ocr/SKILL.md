---
name: review-ocr
description: Use when the user names review-ocr or asks for a coverage-ledger review of a diff or pull request.
disable-model-invocation: true
---

# Review OCR

Experimental sibling of `review` for code diffs and pull requests, adapted from Alibaba's Open Code Review. Code decides what gets reviewed and whether findings hold. Fresh-context reviewers spend their attention on finding defects. Kris runs it side by side with `review` to compare, so keep the two skills independent.

This skill replaces how a review is inspected and verified. Framing, lenses, the finding shape, and fix scope come from [`review`](../review/SKILL.md), read as reference.

## 1. Frame

Follow the Frame section of [`review`](../review/SKILL.md) and select lenses from its [lenses](../review/references/lenses.md). Pick effort from the request: low runs 1 round, medium runs 2, high runs 3. Default to medium.

## 2. Build the ledger

Write `ledger.md` in the scratchpad or a temporary directory. Add one row per changed path from `git diff --numstat -M <base>...<head>`, plus untracked files in workspace mode. Columns: path, status, added/deleted lines, group, state.

Every row starts `pending` and ends `reviewed` or `skipped: <reason>`. Skip only with a concrete reason: deleted, binary, generated (name the marker or generator), lockfile, vendored, snapshot, or secret path. Tests and fixtures are reviewed.

Done when no row is `pending` and the ledger ends with total, reviewed, skipped, and coverage rate.

## 3. Group

With fewer than 4 reviewable files or fewer than 200 changed lines, make one group. Otherwise partition the reviewable files into groups of at most 10 that must be read together: interface and implementation, producer and consumer, schema and its callers, locale siblings, one feature's directory. Split any group whose diff exceeds about 1,500 changed lines. Record each file's group in the ledger.

## 4. Run review rounds

Run groups in parallel. Within a group, rounds are sequential:

1. Round 1 dispatches a fresh reviewer with the [reviewer brief](references/reviewer-brief.md). Include the plan section when the group's largest file changed 50 or more lines, or the group changed 100 or more lines in total.
2. Fact-check the round's findings with [fact-check](references/fact-check.md). Surviving findings join the group's confirmed list.
3. Each later round dispatches a new fresh reviewer with the brief, the confirmed list, and no plan. Dropping the plan stops round 1's risk list from capping what later rounds read.
4. Stop the group early when a round confirms nothing new or the group reaches 30 confirmed findings.

Reviewers report coverage per file. Send a file a reviewer left uncovered to a follow-up reviewer in the same round. Mark it `reviewed` once any reviewer covered it.

Done when every group finished its rounds or recorded why it stopped early, and the ledger has no `pending` row.

## 5. Anchor

Locate each surviving finding by its quoted `code` in the new version of its `path`. Search the first quoted line with `grep -nF`, then confirm the following lines match. A match sets the line range. With no match, re-quote the smallest contiguous range from the diff that the claim targets and search again. If that also fails, report the finding as unanchored with its path and no line.

## 6. Report

Start with the ledger summary: total, reviewed, skipped with reasons, coverage rate, and the rounds each group ran with its stop reason.

Report findings in `review`'s shape, blockers before considerations, each tagged `confirmed` or `unverified`. Nits are dropped here, never during fact-check. End with the disproven findings, one line each, naming the source line that disproved it, so the comparison with `review` shows what the fact-check removed.

When fixes are in scope, follow the end of `review`'s Report section.
