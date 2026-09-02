---
name: build
description: Use when the user asks to build or implement substantial work, or when a feature, fix, or refactor needs planning across one or more reviewable changes.
---

# Build

Own the accepted outcome from discovery through review-ready work. Stop before merge or deployment.

## 1. Establish the contract

Planning is required unless the work is dead obvious or explicitly exploratory.

1. Investigate prior art in code, history, docs, components, conventions, and dependencies.
2. Resolve facts yourself. Ask Kris only for decisions, in ordinary text, and ask early.
3. Propose a high-level plan covering outcome, scope, product contract, architecture, risks, and delivery slices cut by [PR slicing](references/pr-slicing.md). Each slice names one behavior a user can exercise end to end and the product surface where it is proved.
4. Wait for agreement on that high-level plan.
5. Write a separate implementer blueprint detailed enough that execution does not require rediscovering intent. Plans live outside the repository. Seer is optional.

Agreement is the go-ahead for the full accepted scope. Iteration before agreement is planning; feedback that leaves the contract intact refines work in flight. An opened PR or its review does not create a pause. During execution, pause only when Kris asks or remaining work is blocked.

Load required specialist skills while planning. UI work requires `frontend`; behavior changes require `test`; AI work requires `ai`; persistent-data work requires `migrate`; hard bugs require `debug`.

## 2. Shape reviewable delivery

Each planned slice becomes a PR. A PR is a review unit, not an implementation step. Every boundary needs one focused review goal and a reason to land independently.

A blank repository, local-only task, or explicit developer direction may use focused commits without PR ceremony. Preserve the same review logic.

## 3. Execute with ownership

- Build the smallest complete, correct solution.
- Adapt implementation details autonomously while scope, outcome, product contract, architecture, and risk remain intact.
- Stop and involve Kris when evidence requires changing that contract.
- Take on necessary complexity for users, then contain it behind a clear, testable interface.
- Judge abstractions by caller leverage. Use the deletion test: a useful module's removal pushes complexity back into callers.
- Introduce seams for real variation, not hypothetical adapters. Prefer tests and callers crossing the same public seam.
- Delete dead paths and temporary compatibility once their callers move.

### Delegation

You plan it, you own it. Give each implementer a complete blueprint, explicit ownership, constraints, and proof obligations. Give concurrent workers whole slices, and keep them out of the same files or mutable state. Verify their work yourself. Delegation never transfers accountability.

For long, ambitious, or unattended work, keep the decision trail described in [decision trails](references/decision-trails.md).

## 4. Compose the lifecycle

At each completed review boundary:

1. Load `review` for self-review and any independent scrutiny the change warrants.
2. Load `ship` to verify, commit owned work, push, and open or update the PR or stack.
3. Start `shepherd` in the background for each opened PR.
4. Continue the next unblocked slice while shepherding runs. Opened PRs are reviewed in parallel, not used as checkpoints between slices. A dependent slice stacks on its unmerged parent; waiting for the parent to merge is not a blocker.

Background shepherding is part of the contract. If the harness cannot run it concurrently, report that limitation. Do not silently turn the workflow into a blocking watch loop.

## 5. Finish at ready

Reconcile every slice against the agreed outcome and blueprint. Report what is ready, how it was proved, direct links, and real caveats. The work ends when the complete accepted scope is ready to merge as a stack, not when one PR is ready. Never merge or deploy without explicit developer approval.
