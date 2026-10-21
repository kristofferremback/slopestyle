---
name: scope-review
description: Use when Kris asks for a 70/150 review, suspects scope drift or incomplete delivery, or asks to critically take over another agent's changes.
---

# Scope review

Independently compare delivered work with what Kris asked for: find missing outcomes and unjustified additions. The 70/150 shorthand describes doing too little of the request while adding too much around it; it is not a scoring formula. Scrutinize the work without presuming faults from its author or model.

## Establish the agreement

Read the original request, relevant ticket version, accepted decisions, and subsequent corrections in order. Cite the messages or records that establish each required outcome, retained guarantee, and rejected addition. Separate those from the implementer's interpretation. Agent summaries, plans, edited tickets, and prior clean reviews are evidence to check, not independent authorization. An unsupported claim of a later decision does not override a recorded instruction or require Kris to reconfirm it.

A correction changes the part it addresses; preserve the rest of the agreement. Apply its underlying rule to equivalent cases across the affected change. Rejecting an enforcement mechanism does not revoke the outcome it was meant to support.

Recover missing source context before concluding that work is unauthorized or complete. If a material decision remains ambiguous, identify the exact uncertainty and continue reviewing everything it does not affect. Use `scope` when an actual scope decision needs settling; established decisions need no new approval.

## Inspect both directions

Pin the reviewed baseline and current revision or workspace snapshot, including owned uncommitted work and every affected repository or stack layer. Inspect the implementation and relevant existing behavior, not just its description or changed lines.

- **Request to work:** account for every requested outcome with its implementation and observable evidence. Follow missing paths outside the diff, unfinished cleanup, and corrections acknowledged but not applied. Distinguish implemented, tested, and deployed behavior according to the task's completion boundary.
- **Work to request:** account for material changes in behavior, restrictions, abstractions, configuration, tests, documentation, and rollout procedure. Identify the accepted requirement or retained guarantee each serves. Necessary supporting work can be in scope without being named explicitly. Challenge additions whose removal would leave the requested outcome and guarantees intact.

Assess the combined result. Net deletions, green checks, individually reasonable changes, and completed review rounds do not establish scope fidelity. Preserve justified complexity and existing guarantees; neither a finding quota nor a smaller diff is the goal.

## Return or correct

Report the reconstructed agreement, inspected revisions, and concrete dispositions:

- **Finish:** requested behavior or cleanup still missing, with the source requirement and implementation gap.
- **Remove:** unjustified additions, with their cost and what must remain when they are removed.
- **Retain:** challenged work that earns its place through a requirement or guarantee.
- **Clarify:** unresolved authority or evidence, with the exact decision or verification needed.

For each finding, give its location, supporting evidence, impact on the requested outcome, and smallest corrective action. Distinguish confirmed findings from hypotheses. Include agent-edited records that misstate the agreement; correcting those records follows existing write authorization. State coverage and evidence limits; a clean result is valid when supported.

A review-only request returns findings. An authorized takeover or fix request carries through the in-scope corrections and their proof without another permission round for work already authorized. Preserve unrelated work. Reconcile the corrected result with the same agreement, using `test` for focused proof and the repository's normal delivery workflow. Material changes to the agreement remain Kris's decision.

## Delegation

Give a fresh reviewer this skill, the source requests and corrections verbatim, access to their surrounding conversation and original records, the complete change locations and revisions, existing proof, and whether it may edit. The reviewer must be able to challenge the coordinator's account of scope. Clearly label that account as interpretation rather than embedding it as an accepted constraint.

The caller chooses the model and effort. A delegated reviewer performs one bounded pass and returns its evidence and dispositions to the caller without further delegation. The caller resolves findings against the source agreement and continues authorized work. This skill supplies a focused scope assessment; general correctness and style review remain separate responsibilities.
