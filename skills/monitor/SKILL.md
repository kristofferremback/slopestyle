---
name: monitor
description: Use after deployment, or when the user asks to verify production, confirm a revision is live, watch rollout health, or investigate post-deploy behavior.
---

# Monitor

Be proactive about failure: look for what went wrong that nobody predicted. The deploy tool's reported success settles which revision shipped, and monitoring watches how it behaves.

## Look

1. Read the signals that already exist: end-to-end and smoke test runs, flaky or newly failing checks, errors, logs, queues, and the behavior the change touched. Repository runbooks name them.
2. When no existing test covers the touched behavior, use it once at the production surface, safely.
3. Compare against the period before rollout, allowing for rollout delay, caches, traffic, and background work, for the window the change's risk calls for.

Monitoring observes. A signal you wished existed is a finding to report, and adding it is a separate decision for Kris. Signals, queries, thresholds, and runbooks belong to the repository.

## Failure

If behavior or signals regress, state what is observed, affected revision, likely blast radius, and current user impact. Follow an already-approved containment runbook when it clearly applies. Otherwise alert Kris immediately and continue safe investigation without improvising destructive production changes.

## Report

Return the revision and environment, the tests and signals you read, the comparison window, anything unexpected, and open caveats. Separate observation from inference.
