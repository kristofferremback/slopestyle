---
name: review
description: Use when the user asks to review, challenge, stress-test, or independently scrutinize code, a diff, pull request, plan, or risky change.
---

# Review

Routine self-review always. Add independent adversarial review for substantial work and risky seams. Scale effort and lenses to the change.

## Frame the review

1. Pin the exact scope and fixed point. For a PR, capture its current head SHA.
2. State the intended outcome from the accepted plan, prompt, ticket, and PR body.
3. Read repository guidance and relevant specialist skills.
4. Identify the risk profile and select only applicable lenses from [review lenses](references/lenses.md).

Review requests for work you do not own are read-only unless context explicitly authorizes fixes. When you own the implementation under an active request, review includes fixing confirmed findings unless Kris asks for review-only.

## Inspect

Follow behavior and data through their complete lifecycle, not only changed lines. Check callers, consumers, cleanup, retries, reverse actions, concurrency, boundaries, and every applicable product surface.

Load `blast-radius` for wide changes, risky seams, wire or schema changes, dependency behavior, timing, flags, and small diffs whose safety rests on facts outside the patch.

Do not rerun broad green gates merely to appear thorough. Read existing evidence and run only focused probes needed to prove or disprove a finding.

## Independent review

Use fresh context for independent scrutiny. One combined reviewer is enough for ordinary substantial work. Add reviewers only when distinct expertise or change breadth earns them. Do not hardcode model names, spawn one reviewer per minor lens, or let reviewers delegate.

Give reviewers the intent, fixed diff, applicable guidance, and assigned lenses. Ask for actionable findings with concrete evidence, not style inventories.

The orchestrator verifies every material claim against source before publishing it. Independent reviewers advise; the orchestrator owns the verdict.

## Report

Order findings by impact. Each finding includes:

- behavior that fails or risk introduced,
- concrete location,
- evidence or reproducible trajectory,
- why it matters to the accepted outcome,
- smallest correct direction for a fix.

Separate blockers from considerations. Drop nits, tooling-enforced issues, duplicates, and claims that do not survive verification. If no issues remain, say which lenses ran and what evidence was inspected.

When fixes are in scope, implement confirmed findings, run focused proof, and perform a clean re-review of the changed risk. Never dump raw reviewer output into chat or onto a PR.
