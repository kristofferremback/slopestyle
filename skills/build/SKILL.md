---
name: build
description: Use when the user asks to build or implement substantial work, or when a feature, fix, or refactor needs planning across one or more reviewable changes.
---

# Build

Own the accepted outcome from discovery through review-ready work. Stop before merge or deployment.

## 1. Establish the contract

Planning is required unless the work is dead obvious or explicitly exploratory.

1. Investigate prior art in code, history, docs, components, conventions, and dependencies. Discovery is scoped to the first slice: read the files that slice touches yourself and dispatch one explorer per open question at medium breadth. Findings land in the blueprint; the explorer's transcript does not.
2. Resolve facts yourself. Ask Kris only for decisions, in ordinary text, and ask early.
3. Propose a high-level plan covering outcome, scope, product contract, architecture, risks, and delivery slices cut by [PR slicing](references/pr-slicing.md). Each slice names one behavior a user can exercise end to end and the product surface where it is proved.
4. Wait for agreement on that high-level plan.
5. Write the implementer blueprint: numbered steps in execution order, each naming its owned files, one bounded outcome, a checkable completion criterion, and exact focused proof commands selected with `test`. Split steps that still require broad discovery before implementation. Steps may cut finer than PR slices. The plan persists where the project keeps plans (decision records, test plans, tickets). The blueprint is ephemeral: it lives on local disk for the duration of the work and is never committed.

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

You plan it, you own it. Run the blueprint steps in order. Each step has two passes, each a fresh subagent on a cheaper model at low effort, handed the previous pass's result:

1. **Implement.** Give it the step's blueprint entry, owned files, constraints, and focused proof commands. Finish when the completion criterion is met and the proof passes.
2. **Verify and fix.** Give it the diff, completion criterion, and evidence handoff. Independently inspect the behavior, use `test` to select checks and reuse valid evidence, fix what a criterion proves wrong, and report anything larger back instead of redesigning.

Passes hand off directly; avoid repeating their code verification between passes. Review each completed PR at the lifecycle boundary below, then verify the whole stack against the plan and blueprint when every step is done. Fixes smaller than a step you make by hand; larger ones become new steps through these two passes. Concurrent steps own disjoint files and mutable state. Delegation never transfers accountability.

Operational supervision continues between passes. Check progress and update Kris at least every 20 minutes while work runs long, using available status or log tools without repeating the code review. If the harness cannot surface progress during a pass, split assignments so agents return at that checkpoint with completed work, evidence, and the next action. After two unsuccessful attempts at the same problem without new evidence, reassess the approach and report the blocker rather than repeat it. A checkpoint is not authorization to stop a session or waive a failing check.

For long, ambitious, or unattended work, keep the decision trail described in [decision trails](references/decision-trails.md).

## 4. Compose the lifecycle

At each completed review boundary:

1. Run one fresh low-effort subagent with `simplify` over the complete PR diff, even for a small PR. This pass belongs to the PR, not each implementation step. Hand it the accumulated proof evidence. Later review fixes get focused simplification of their delta, not another full-PR pass unless they materially change the design.
2. Load `review` for self-review and any independent scrutiny the change warrants.
3. Load `ship` to verify, commit owned work, push, and open or update the PR or stack.
4. Start `shepherd` in the background for each opened PR.
5. Continue the next unblocked slice while shepherding runs. Opened PRs are reviewed in parallel, not used as checkpoints between slices. A dependent slice stacks on its unmerged parent; waiting for the parent to merge is not a blocker.

Background shepherding is part of the contract. If the harness cannot run it concurrently, report that limitation. Do not silently turn the workflow into a blocking watch loop.

## 5. Finish at ready

Reconcile every slice against the agreed outcome and blueprint. Report what is ready, how it was proved, direct links, and real caveats. The work ends when the complete accepted scope is ready to merge as a stack, not when one PR is ready. Never merge or deploy without explicit developer approval.
