---
name: review-beta
description: Use only when an existing prompt explicitly names review-beta; forwards to review.
---

# Review beta

Read and follow [`review`](../review/SKILL.md), preserving the requested scope and effort.

This forwarding entry keeps saved review jobs usable during the migration to `review`. New workflows call `review` directly. Retire this entry once local callers have switched and saved jobs that name `review-beta` have finished.
