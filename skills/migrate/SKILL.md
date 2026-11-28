---
name: migrate
description: Use when changing persistent data, database schemas, migrations, backfills, compatibility windows, data repair, or rollout sequencing around stored state.
---

# Migrate

Migrations move forward. Applied migrations are immutable. Create a new migration to correct anything already on main or applied elsewhere.

## Plan compatibility

- Name each contract the change breaks across releases: stored formats, messages, APIs and flag meanings. Old and new releases run side by side during a deploy, and a flag change reaches instances unevenly.
- Keep each contract compatible through a structural guarantee: additive fields old code ignores, expand and contract, or versioned messages a worker claims only up to the version it understands. Put the guarantee in the shared owner (queue, store, flag reader) so every feature inherits it, and propose adding it there when it is missing. Feature code that detects and repairs one rollout window earns no place.
- Roll forward. A rollback gets the safety compatibility already gives, and nothing built for it alone.
- Identify the point where each contract becomes active.
- Expand before switching behavior; contract only after every caller and stored row has moved.
- Derive schema and application types from one authoritative source where practical.
- Keep transient migration workflow state separate from domain entities.
- Avoid long transactions and read-then-write races. Prefer atomic operations, version-guarded optimistic locking, or explicit locks.

## Backfills

A backfill is not shipped because code exists. Ship its activation and observability.

- Start only after compatible code is live.
- Make each unit idempotent, bounded, resumable, and safe under retries or concurrent workers.
- Persist progress and expose throughput, failures, retries, completion, and remaining work.
- Keep transactions short. Read needed state, release scarce resources during slow external work, then reacquire and validate before writing.
- Define containment and restart behavior for partial failure.

## Proof

Load `test`. Prove each compatibility guarantee: old code leaves alone what new code writes, and new code reads what old code wrote. Verify activation, progress, completion, and cleanup. Repository migration tooling and runbooks own exact commands.
