---
name: recall
description: Use when Kris asks to catch up, recall work on a topic, resume stale work, find where he left off, or reconstruct current state from prior sessions.
---

# Recall

Rebuild missing or stale working context. `handover` preserves known state forward; `recall` reconstructs it later.

1. Fix the workspace, topic, and time window. Default to the active workspace and a recent bounded window. Never search another workspace without being asked.
2. Search relevant harness transcripts and Threa records. Fan out bulk reading when useful, but keep raw transcripts out of the main context.
3. For a named feature, bug, or subsystem, use `why` to search relevant shared history for prior attempts, user reports, incidents, and decisions.
4. Verify historical claims against live git branches, PRs, tickets, checks, and deployed state. A transcript is history, not truth.
5. Stop when the named topic has enough current state to act. Exclude adjacent work unless it blocks this thread.

Return:

- **Capsule:** at most five bullets
- **Threads:** one status-tagged line per active, merged, reverted, planned, or uncommitted thread
- **Problems:** at most five recurring failures or unresolved risks
- **Next move:** the single most useful concrete action

Use direct links and mark evidence, inference, and gaps.
