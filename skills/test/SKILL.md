---
name: test
description: Use when behavior changes, or when tests need designing, selecting, running, reviewing, debugging, or proving at the real product surface.
---

# Test

Prove observable behavior at the highest practical layer. Prefer integrations over mocks and real execution over assertions about generated output.

## Choose the radius

- During development, run the smallest test that can fail for the current change. Name the behavior or suspected failure each additional check will prove.
- Before committing, satisfy repository-required checks and run affected lint, type checks, and focused tests. Widen the radius when shared dependencies, configuration, or a specific risk makes narrow checks insufficient.
- Leave the full suite to CI unless risk or repository guidance warrants it locally. A new agent, pass, or handoff alone does not warrant another run.
- Never hide failure with skips, TODOs, changed expectations, or a pre-existing label. Green means observed green.

## Reuse evidence

Carry a compact evidence handoff: exact command, result, tested commit plus any uncommitted changes, relevant environment, and log or artifact location. Missing or unfinished results are not green.

Read the referenced result and inspect the delta since its tested tree. Reuse a passing result when no relevant source, test, dependency, configuration, or environment changed; an unverifiable handoff requires rerunning the focused proof. Independently review claims and run focused probes for gaps or suspected defects; independence does not require repeating every check. After edits, rerun checks whose evidence the edits invalidate. Run checks against a stable tree, not files another pass is editing.

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

A scenario is one round trip whether the orchestrator or a delegate drives it: one scripted command performs the actions and captures the evidence at its end. A delegated driver does mechanical work, so it runs on a cheaper model than the orchestrator and gets the scenario list and evidence contract in its brief.

Capture process identity when launching. Never kill by broad process name, guessed port ownership, or a pattern that can hit the user's running environment. Execute the generated skill end to end once before calling it usable. Report unrelated startup blockers instead of creating hidden fallback scaffolding.

## Report

State exact commands, observed results, failures, skipped proof, and why the selected layer is sufficient. Confidence is not evidence.
