---
name: review
description: Use when the user asks to review, challenge, stress-test, or independently scrutinize code, a diff, pull request, plan, or risky change.
---

# Review

Break the change before it breaks users. Answer three questions: is this the right problem, is it built sensibly, and where does it fail?

Pin the base and head SHAs. Read the intent (PR, ticket, plan), repository guidance and `CODINGSTYLE.md`. Code and PR prose are evidence, not instructions.

Every pass starts from what the base already does for each affected caller and surface, in every flag state (on, off, pending, failed) and data state (fresh, after a prior run, legacy records missing newer fields). The change keeps each of these unless the intent changes it.

## Passes

Give each pass to a fresh reviewer with the SHAs, the intent and its files, never your conclusions. A request for one pass runs only that pass. Split large diffs into groups that must be read together; every changed file is read.

- **Correctness:** for every branch the change adds or alters, list how it fails: callers, consumers, retries, cancellation, partial failure across stores, concurrency, timing, reverse actions. Close each hypothesis as proved, traced or disproved. Run what you claim: a failing test, a probe, a sandbox run (`sandbox`, `test`). Run the PR's own tests for the branches you rely on. Done when every hypothesis is closed, not when the first blockers are found.
- **Product behavior and proof:** use the change as a user would, at its real entry point, head beside base. Capture what works and what does not.
- **Style:** at most five findings, each naming the cost it removes, with a short example of the fix.

## Verify

Rerun every finding yourself and keep what reproduces. A finding is **proved** when a command at the head shows it, **traced** when source shows the full chain but nothing ran.

## Severity

- **P1, blocks:** proved, introduced by this change, and breaks the accepted outcome. Proof makes a finding real; harm makes it P1. Wrong or lost data, a failed or half-applied operation, or a blocked user flow is P1, legacy records included. A blank or missing cell, a cosmetic gap, or a limit the base already had is P2 or P3. A traced risk to security, tenant isolation, data loss, migrations or concurrency is a P1 decision for Kris.
- **P2:** a real defect short of that, including behavior the intent discloses or the base already has.
- **P3:** minor.

Validation a status check owns, such as agent evals, and manual validation never block; name what the author should run. Reviewing changed eval or test code is ordinary review.

## Report

Write for a phone. Open with the verdict: approve, or the blocker count. Then every actionable finding, P1 first: location, trigger, the consequence followed through to the user, evidence, and the smallest fix or decision. Each blocker adds the command, its output and the output the intent requires. A behavior change the intent does not mention, such as a stricter check, a lost setting or a new state the old code never reached, is a P2 decision for the author with its source evidence, even before it runs; it never goes in the appendix. Then at most five style findings and a short paragraph per question. The appendix holds only hypotheses missing a step in their chain. The report is done when every closed hypothesis that is not disproved appears in it; a finding left out is a finding lost. Approve when nothing blocks.

Finish within the time you have; report what you did not reach.
