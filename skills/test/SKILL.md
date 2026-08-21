---
name: test
description: Use when behavior changes, or when tests need designing, selecting, running, reviewing, debugging, or proving at the real product surface.
---

# Test

Prove observable behavior at the highest practical layer. Prefer integrations over mocks and real execution over assertions about generated output.

## Choose the radius

- During development, run the smallest test that can fail for the current change.
- Before committing, run warranted focused tests and lint or type checks scoped to the changed package.
- Let CI own repository-wide checks and full suites unless repository guidance or a named risk warrants them locally.
- Never hide failure with skips, TODOs, changed expectations, or a pre-existing label. Green means observed green.

## Coordinate the run

The coordinating agent owns one verification plan across implementers, reviewers, worktrees, and commit hooks.

- Give implementers only slice-local red and green checks. They return the exact commands and results.
- Reuse passing evidence while the covered code, dependencies, and test configuration remain unchanged. Reviewers run new checks only for a concrete unresolved risk.
- Run each warranted integrated or broad local check once, after the relevant work has converged.
- Treat repository-wide lint, typecheck, build, browser, end-to-end, and worker-pool commands as heavy. Run each through `$HOME/.local/bin/slopestyle-heavy -- COMMAND`. If the guard is unavailable, report it, inspect active processes, and wait until other heavy work finishes.
- Use one worker for local browser and worker-pool checks. CI owns parallel execution.
- When a hook starts heavy checks, run the initiating command through `$HOME/.local/bin/slopestyle-heavy` and let the hook own checks it already runs instead of pre-running them. Exit 75 means the guard timed out waiting for the reported owner, not that the check failed.
- Stop background services and browsers started for verification when the check ends. Never disturb processes another worker owns.

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
