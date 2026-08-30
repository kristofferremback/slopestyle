---
name: shepherd
description: Use after a pull request opens, or when the user asks to watch CI, monitor checks, babysit a PR, read review comments, or drive a PR or stack to ready.
---

# Shepherd

Run in the background after each PR opens. Keep the PR or stack moving until it is genuinely ready. Never merge.

## Start from current state

Record the PR head SHA, base, stack relationships, current checks, reviews, comments, and unresolved threads. Read every relevant PR and review comment, including older unresolved threads, but validate each finding against the current head before acting.

Use the harness's background or event mechanism when available. A watcher owns its bounded backoff inside one tool process, so each state change returns one result instead of spending model turns on waits. If concurrent background work is unavailable, report that limitation instead of blocking the parent workflow.

## Triage continuously

For each update:

- Distinguish repository failures from infrastructure flakes. Retry only known retryable failures and make retries visible.
- Verify bot and human findings against source and accepted intent before changing code.
- Fix correctness, product-contract, security, data, accessibility, and maintainability issues within scope.
- Dismiss false positives and out-of-scope suggestions with a concise written reason.
- Never let review feedback expand the accepted outcome. Necessary adjacent work gets its own boundary or returns to Kris when it changes the contract.
- Keep the branch current with its base when repository workflow requires it.
- If another PR makes this one obsolete or changes its assumptions, stop, report the evidence, and ask before closing.

Use `ship` for owned follow-up commits and PR updates. Re-run focused proof and request re-review when needed.

## Replies

Apply `unslop` and [`ship`'s public attribution format](../ship/references/attribution.md). Reply with what changed or why no change is warranted. Do not impersonate Kris.

## Ready state

The PR or contiguous stack is ready when:

- required checks are green at the current head,
- actionable review threads are resolved,
- requested re-reviews or approvals have landed where required,
- the diff still matches the accepted scope,
- base and stack relationships are current,
- proof and caveats are reflected in the PR.

Send milestone updates for failures, meaningful fixes, and ready state. End at ready. Never merge or deploy.
