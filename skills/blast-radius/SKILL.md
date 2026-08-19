---
name: blast-radius
description: Use when the user asks what a change could break, requests a blast-radius check, or a review needs safety proof beyond the diff.
---

# Blast radius

Find breakage that symbol search and a convincing write-up can miss. Prove the load-bearing safety facts through real code or mark them unproven.

## Investigate

1. Read the exact change, intended outcome, current head, and relevant history.
2. Identify the one or few facts the change's safety depends on.
3. Follow each fact beyond direct callers into lifecycle timing, teardown, wire formats, persisted data, other languages, pinned dependency source, local patches, feature flags, and downstream consumers.
4. Walk credible failure trajectories step by step. Separate confirmed risks from cases the evidence clears.

## Proof ladder

Take each safety fact as far down this ladder as practical:

1. Stated but unsupported
2. Anchored to source
3. Failure path shown unreachable
4. Real script or test exercises the shipped code
5. Reproduced in the running product

Facts below level 4 remain explicitly unproven. Prefer one small executable probe over a long argument.

## Output

Report:

- what changed beyond the obvious diff,
- each load-bearing safety fact and proof level,
- confirmed risks with likelihood, cost, and evidence,
- cleared risks and why they are safe,
- the cheapest proof still needed before merge.

Apply `unslop`. Strip private data before public use. `review` decides whether independent adversarial reviewers are warranted.
