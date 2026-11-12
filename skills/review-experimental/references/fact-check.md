# Fact-check

Decide whether each finding is true. Its impact is assessed in Report; action is decided through [fix disposition](fix-disposition.md).

Every finding ends as exactly one of:

- **proved**: a rerunnable command over the shipped code or configuration prints output that contradicts the accepted intent: a failing test, a repro script, a configuration diff, a plan, or a dumped job graph. Rerunning the reviewer's command reproduces it. Record the command, its output, and the output the intent requires. Consequences beyond what the output shows stay traced, and the finding says which part is which.
- **traced**: source evidence supports the claim, but no run shows it. A traced finding is a blocker only for security and authorization, data loss, migrations, or concurrency, where a run is often impractical, and only when the accepted intent and constraints leave that risk undecided; report those as decisions for Kris. Report other traced findings as actionable considerations when the accepted contract, reachable trigger, and complete source-to-consumer chain establish a concrete violation. Label them source-backed, state what execution is missing, and keep readiness inconclusive for that behavior. Mere possibilities or missing premises remain unproved. Never claim that source tracing is a successful runtime test.
- **unverified**: you could neither support nor disprove it. It stays in the report as unproved.
- **disproven**: source or a focused probe proves the claim wrong. It leaves the findings and is listed with the evidence and reasoning that disprove it.

An accepted gap or constraint covers the behavior it names. A consequence it leaves unnamed, such as what users see or which resource stays held, is judged as its own finding. Use evidence to distinguish these outcomes. Low impact or disagreement with a suggested fix does not disprove a claim. Uncertainty stays unverified rather than becoming a reason to dismiss it or implement its proposed fix.

## Contract and trigger

An executed probe proves only the behavior it executes. Before calling that behavior a defect, establish the required result independently and show a reachable trigger at the reviewed head. A test constructor, an optional type, or the ability to call an internal function is not by itself a production trigger or an acceptance contract. Trace the actual producer and its validation. If accepted scope, guidance and tests conflict, retain that conflict explicitly rather than selecting the premise that makes a blocker.

Keep a concrete, material behavior change as an actionable **scope consideration** when the complete source chain proves an effect outside the stated change, but its acceptance is unresolved. State the trigger and exact consequence, the prior or authored behavior it changes, and the decision or smallest fix needed. Label it a behavior decision, not an established defect. A generic request for more testing is insufficient. Possibilities with missing causal premises remain hypotheses.

For restoration, replay and migration, distinguish authored inputs from derived outputs, caches and resolved defaults. Compare the complete settings before and after, including optional/legacy paths, rather than treating a read-only reconstruction helper as an information-preserving write contract.

## Method

Write the analysis for each finding before its outcome.

1. State the central claim and its conditions. Locate the described behavior in the fixed source, searching beyond the quoted snippet; an incorrect location alone does not settle the claim.
2. Rerun the reviewer's command at the fixed head. A finding that arrived without a command, or whose rerun passes, can still be traced or disproven from source; it cannot be proved. Keep one receipt for the coordinator's independent rerun, identifying the fixed source, fixture, command and result. Reuse that receipt during later reconciliation and synthesis. Rerun when the source, relevant environment or fixture changes, execution was failed or incomplete, or a new causal question needs different proof. A second reading of the same finding does not invalidate its completed receipt. This does not waive the initial independent rerun or the investigation of a new premise.
3. Trace the relevant execution path through callers, consumers, state owners, and enforcement boundaries. For a failure in a shared owner, identify the concrete consumers that inherit it and preserve that affected scope in the final claim. Distinguish paths exercised by a probe from those established by source tracing. A protection elsewhere counts when it covers the claimed path; check alternate entry points and bypasses. For concurrency, security, and compatibility claims, inspect ordering, enforcement, and retained guarantees rather than assuming the language or runtime supplies them.
4. When a traced claim is cheap to run, write the probe and rerun the outcome. Disproof may span several functions or files: cite each premise and explain how they rule out the claimed failure. A passing happy-path test or an untraced assumption is insufficient. When a material premise remains uncertain, keep the finding unverified and name the missing evidence.

Evaluate a protection against the exact claimed consequence. A bound, refusal, exception or cleanup guard can preserve safety while making an otherwise valid user journey fail. Trace what the user receives after the guard fires; distinguish prevention of the trigger from detection of its consequence. Do not replace a concrete availability or meaning claim with a stronger security claim and then dismiss both when the stronger one is disproven.

## Mandatory acceptance gates

Keep repository-mandated pre-merge validation separate from proof of a code defect. Inventory the exact required checks, scenario/slice union, modes, model configurations and accepted waivers. For a changed shared prompt, tool, validator or eval judge, trace its users to determine that union rather than choosing one convenient slice. Match completion receipts to the reviewed commit and configuration. Each mandatory gate names its authority in repository guidance, an accepted requirement or a required check, along with its exact coverage and receipt status. A reviewer-created test matrix does not acquire that authority from a “required” heading.

Resolve conflicting authorities before declaring a gate mandatory. Apply the applicable precedence and chronology to what each requirement actually covers. A newer accepted direction can change an older policy without waiving unrelated guarantees; implementation alone does not establish that acceptance. A proposed policy change or missing completion receipt does not suspend a gate whose current applicability is established. Distinguish that case from uncertainty about whether an older authority still applies. When the supplied records leave that applicability unresolved, retain a policy consideration and its missing authority rather than requiring an invented waiver.

A known failing or unfulfilled mandatory gate blocks readiness without proving a code defect. When receipts are unavailable, readiness is unverified: state the exact green receipts required before merge, and distinguish that requirement from a claim that nobody ran the checks. Missing local dependencies establishes only that this review could not execute them. Existing current-head receipts and explicit accepted waivers count; generic test-unavailability prose cannot discharge a mandatory gate.

Keep targeted proof for a retained finding attached to that finding, with the property it settles and the strongest appropriate test surface. Distinguish that proof from exploratory coverage and additional confidence checks. Recommend those additional checks in the assessment; their absence alone does not create an independent merge requirement. Preserve the real policy-required suites and model/mode coverage, and the finding’s own proved or traced decision disposition.

## Style evidence

Style findings end as **confirmed** or **disproven**; `proved` belongs to runs. Confirm the claimed reading or maintenance burden against the fixed source and applicable guide: responsibilities a reader must track, repeated policy, hidden assumptions, or an expression that obscures intent. A runtime defect is unnecessary. Compare the proposed caller and owner, and test its preservation claims separately. Confirming the current burden does not certify the suggested refactor as behavior-preserving. Keep unimplemented examples labelled and check ordering, effects and contracts before recommending them.

For callable-boundary preconditions, apply the style workflow's [input-contract assessment](style-review.md#input-contracts).
