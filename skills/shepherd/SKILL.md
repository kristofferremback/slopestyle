---
name: shepherd
description: Use after a pull request opens, or when the user asks to watch CI, fix failed checks, read review comments, or drive a PR or stack to ready.
---

# Shepherd

Monitor each opened PR with a background script or event subscription. Write watch output to a temporary file and return a sparse completion report to the owning agent, which decides and acts. Keep the PR or stack moving until it is genuinely ready. Never merge.

## Watcher authority

The owning agent handles diagnosis, fixes, reruns, and review replies. The watcher observes and reports only: it does not edit, commit, push, rerun checks, post replies, or resolve threads. A reported failure remains the owning agent's responsibility. Any separately delegated fix needs its own explicit scope and authority. Keep one writer per checkout.

## Own the fix loop

For a PR the user has authorized you to work on, own diagnosis, in-scope fixes, focused verification, follow-up commits, pushes, and checking the new head. Use report-only mode when the user requests it or write access is unavailable; state that limitation explicitly.

When delegating, pass the PR, checkout, accepted scope and authority to complete this loop. A watcher that only reports failures must have a named owner who acts on them. Keep one writer per checkout; coordinate edits before committing. Delegation does not make an unresolved failure someone else's responsibility.

## Start from current state

Record the PR head SHA, base, stack relationships, current checks, reviews, comments, and unresolved threads. Read every relevant PR and review comment, including older unresolved threads, but validate each finding against the current head before acting.

## Wait without model turns

The script does the watching. A model may launch it and interpret its result, but stays out of the polling loop. Choose the model for the interpretation needed; a stronger model is reasonable when it receives only sparse results. If delegating, give the watcher a fresh, bounded brief containing only the PR, head SHA, run identifiers, reporting criteria, and read-only authority. Do not fork the conversation history.

- Use one background process per PR head. Keep polling, backoff, deduplication, and the last observed state inside that process. Redirect stdout and stderr to a temporary file rather than streaming them into model context. Prefer the harness's completion notification over repeated tool waits that wake the model.
- Poll compact status metadata: head SHA, check identifiers and conclusions, and review/comment identifiers and update times. Finish on success, failure, or another event requiring attention, such as new review feedback, a changed head, or a watcher error. Return only the outcome, affected check/review identifiers, and log path. Unchanged state, routine progress, and tool timeout/keepalive messages stay silent.
- On return, inspect a bounded tail and use targeted `rg` searches in the file. Fetch additional evidence only for the changed review or failed job. Keep raw responses and full test logs on disk; pass only relevant excerpts to the model. For requested timing artifacts, download and aggregate them in code before returning a summary and artifact path.
- Give the process a bounded lifetime and retain its process/session identifier. Stop it on completion, cancellation, superseded head, or user stop. Check that the process has exited; interrupting an agent alone may leave its subprocess running.
- If the harness cannot wait in the background without repeated model wakeups, report that limitation and the pending run link. Continue independent work; do not substitute an agent polling loop or claim monitoring remains active.

The waiting phase ends when a notification needs action or the watcher exits. Elapsed time alone is not a reason to invoke a model.

## Triage continuously

The owning agent handles each actionable report:

- Reproduce failures with the repository's locked dependencies and CI command. For formatting failures, align the local formatter with CI before editing; temporary dependency installs can change the version used by commit hooks.
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
