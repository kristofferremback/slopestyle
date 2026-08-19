---
name: migrate
description: Use when changing persistent data, database schemas, migrations, backfills, compatibility windows, data repair, or rollout sequencing around stored state.
---

# Migrate

Migrations move forward. Applied migrations are immutable. Create a new migration to correct anything already on main or applied elsewhere.

## Plan compatibility

- Identify old and new readers, writers, deploy order, rollback limits, and the point where each contract becomes active.
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

Load `test`. Prove old and new application versions behave through the planned window. Verify activation, progress, completion, and cleanup. Repository migration tooling and runbooks own exact commands.
