---
name: deploy
description: Use when the developer explicitly asks to merge, deploy, release, roll out, or promote a ready pull request or stack.
---

# Deploy

Merge and rollout are external-impact actions. Start only after explicit developer approval. A request to build, ship, or make work ready is not approval.

## Confirm the gate

1. Identify the exact PRs, contiguous stack, revisions, target environment, and rollout path covered by approval.
2. Confirm `shepherd` reached ready state at the current heads.
3. Read repository deployment guidance and runbooks. Load vendor skills such as Railway's `use-railway` when the repository requires them.
4. Verify required credentials and production signals exist. Report missing dependencies; never switch to an unapproved path.

If approval is ambiguous about any PR, environment, migration, or rollout step, ask in ordinary text and continue only unblocked inspection.

## Merge and roll out

- Treat the approved PR set or contiguous stack as the delivery unit. Preserve its reviewed order and relationships using the repository's stack or merge-queue workflow.
- At a blocked gate, diagnose against the current heads first. Before a workaround, identify checks, approvals, or proof it invalidates across the delivery unit and the downstream work it creates. Choose the supported path that advances the whole outcome with the least avoidable rework. Partial merges and rebases can change downstream heads; inspect the tooling's behavior before using them as a workaround.
- Explain a material change in delivery strategy and its downstream cost before acting. Continue within existing authorization; ask only when the change needs a decision beyond it. Routine steps in an approved merge queue or a necessary rebase follow repository guidance.
- Record every merged commit and deployed revision.
- Follow the repository's release path exactly. Do not improvise provider, environment, or migration behavior.
- Keep operations retryable and observable. Stop on unknown partial state.
- Apply activated backfills only after compatible code is live, using `migrate` and the repository runbook.

## Hand off to monitoring

Invoke `monitor` with the expected revision, environment, behavior, rollout time, and relevant risks. A green merge or deployment pipeline is not proof that production is correct.

Report direct links, revisions, rollout status, and caveats. Do not claim success until `monitor` proves it.
