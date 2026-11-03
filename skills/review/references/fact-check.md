# Fact-check

Decide whether each finding is true. Its impact is assessed in Report; action is decided through [fix disposition](fix-disposition.md).

Every finding ends as exactly one of:

- **proved**: a rerunnable command over the shipped code or configuration prints output that contradicts the accepted intent: a failing test, a repro script, a configuration diff, a plan, or a dumped job graph. Rerunning the reviewer's command reproduces it. Record the command, its output, and the output the intent requires. Consequences beyond what the output shows stay traced, and the finding says which part is which.
- **traced**: source evidence supports the claim, but no run shows it. A traced finding is a blocker only for security and authorization, data loss, migrations, or concurrency, where a run is often impractical, and only when the accepted intent and constraints leave that risk undecided; report those as decisions for Kris. Report other traced findings as unproved.
- **unverified**: you could neither support nor disprove it. It stays in the report as unproved.
- **disproven**: source or a focused probe proves the claim wrong. It leaves the findings and is listed with the evidence and reasoning that disprove it.

An accepted gap or constraint covers the behavior it names. A consequence it leaves unnamed, such as what users see or which resource stays held, is judged as its own finding. Use evidence to distinguish these outcomes. Low impact or disagreement with a suggested fix does not disprove a claim. Uncertainty stays unverified rather than becoming a reason to dismiss it or implement its proposed fix.

## Method

Write the analysis for each finding before its outcome.

1. State the central claim and its conditions. Locate the described behavior in the fixed source, searching beyond the quoted snippet; an incorrect location alone does not settle the claim.
2. Rerun the reviewer's command at the fixed head. A finding that arrived without a command, or whose rerun passes, can still be traced or disproven from source; it cannot be proved.
3. Trace the relevant execution path through callers, consumers, state owners, and enforcement boundaries. A protection elsewhere counts when it covers the claimed path; check alternate entry points and bypasses. For concurrency, security, and compatibility claims, inspect ordering, enforcement, and retained guarantees rather than assuming the language or runtime supplies them.
4. When a traced claim is cheap to run, write the probe and rerun the outcome. Disproof may span several functions or files: cite each premise and explain how they rule out the claimed failure. A passing happy-path test or an untraced assumption is insufficient. When a material premise remains uncertain, keep the finding unverified and name the missing evidence.

## Style evidence

Style findings end as **confirmed** or **disproven**; `proved` belongs to runs. Confirm the claimed reading or maintenance burden against the fixed source and applicable guide: responsibilities a reader must track, repeated policy, hidden assumptions, or an expression that obscures intent. A runtime defect is unnecessary. Compare the proposed caller and owner, and test its preservation claims separately. Confirming the current burden does not certify the suggested refactor as behavior-preserving. Keep unimplemented examples labelled and check ordering, effects and contracts before recommending them.
