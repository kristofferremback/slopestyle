---
name: test
description: Use when behavior changes, or when tests need designing, selecting, running, reviewing, debugging, or proving at the real product surface.
---

# Test

Prove observable behavior at the highest practical layer. Prefer integrations over mocks and real execution over assertions about generated output.

## Choose the radius

- During development, run the smallest test that can fail for the current change.
- Before committing, run broad lint and type checks plus warranted focused tests.
- Leave the full suite to CI unless risk or repository guidance warrants it locally.
- Never hide failure with skips, TODOs, changed expectations, or a pre-existing label. Green means observed green.

## Run commands

- Set test and typecheck timeouts with enough margin for a slow run to finish.
- Keep iterative output focused and bounded; request the full log only when the failure evidence needs it.

## Design

- Name tests as `should do x when y` so the contract reads in English.
- Assert meaningful outcomes, objects, events, side effects, and errors. Count only when cardinality is the behavior.
- Prefer whole-object comparisons over scattered property assertions.
- Run generated SQL against a real compatible database rather than snapshotting the string.
- Mock only at a real production boundary when practical integration is unavailable.
- Add regression tests for reported regressions or behavior important enough to protect. Do not test that deleted behavior is absent merely because code was removed.

## Real-product verification

When a repository lacks a scripted path to drive its real UI, CLI, service, or library surface, propose a repository-local `verify-<app>` skill. Create it only after approval. It defines:

- **Launch:** exact isolated startup and readiness signal
- **Doctor:** read-only proof that the instance is ours and usable
- **Drive:** stable user-level controls, selectors, commands, or requests
- **Evidence:** action plus resulting visible and persistent side effects
- **Cleanup:** remove only processes and scratch state created by this run

Capture process identity when launching. Never kill by broad process name, guessed port ownership, or a pattern that can hit the user's running environment. Execute the generated skill end to end once before calling it usable. Report unrelated startup blockers instead of creating hidden fallback scaffolding.

## Report

State exact commands, observed results, failures, skipped proof, and why the selected layer is sufficient. Confidence is not evidence.
