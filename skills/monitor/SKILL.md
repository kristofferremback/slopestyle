---
name: monitor
description: Use after deployment, or when the user asks to verify production, confirm a revision is live, watch rollout health, or investigate post-deploy behavior.
---

# Monitor

Prove the expected revision is live and behaving through repository-specific signals and user-visible behavior.

## Establish proof obligations

Capture:

- expected commit, image, artifact, or release identity,
- target environment and services,
- user behavior that must work,
- failure modes and metrics most likely to move,
- rollout time and useful comparison window,
- repository runbooks and escalation paths.

## Verify

1. Prove the running system serves the expected revision. Do not infer this from a completed pipeline.
2. Exercise the highest-value real behavior safely at the production surface.
3. Inspect repository-specific health, errors, logs, latency, saturation, queues, data integrity, and business signals that apply.
4. Compare against a relevant baseline and account for rollout delay, caches, traffic, and background work.
5. Keep watching for the window the repository or risk profile requires.

Never invent universal thresholds. Signals, queries, rollout mechanics, and runbooks belong to the repository.

## Failure

If behavior or signals regress, state what is observed, affected revision, likely blast radius, and current user impact. Follow an already-approved containment runbook when it clearly applies. Otherwise alert Kris immediately and continue safe investigation without improvising destructive production changes.

## Report

Return the live revision proof, behavior exercised, signals observed, comparison window, outcome, and unresolved caveats. Separate observation from inference. Pipeline green alone is not a successful monitor result.
