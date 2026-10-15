# Fact-check

Decide whether each finding is true. Its impact is assessed in Report; action is decided through [fix disposition](fix-disposition.md).

Every finding ends as exactly one of:

- **confirmed**: you reproduced the claim in source or with a focused probe.
- **unverified**: you could neither prove nor disprove it. It stays in the report.
- **disproven**: source or a focused probe proves the claim wrong. It leaves the findings and is listed with the evidence and reasoning that disprove it.

Use evidence to distinguish these outcomes. Low impact or disagreement with a suggested fix does not disprove a claim. Uncertainty stays unverified rather than becoming a reason to dismiss it or implement its proposed fix.

## Method

Write the analysis for each finding before its outcome.

1. State the central claim and its conditions. Locate the described behavior in the fixed source, searching beyond the quoted snippet; an incorrect location alone does not settle the claim.
2. Trace the relevant execution path through callers, consumers, state owners, and enforcement boundaries. A protection elsewhere counts when it covers the claimed path; check alternate entry points and bypasses. For concurrency, security, and compatibility claims, inspect ordering, enforcement, and retained guarantees rather than assuming the language or runtime supplies them.
3. Confirm or disprove the claim with source evidence or a focused probe. Disproof may span several functions or files: cite each premise and explain how they rule out the claimed failure. A passing happy-path test or an untraced assumption is insufficient. When a material premise remains uncertain, keep the finding unverified and name the missing evidence.

## Style evidence

For style findings, confirm the claimed reading or maintenance burden against the fixed source and applicable guide: responsibilities a reader must track, repeated policy, hidden assumptions, or an expression that obscures intent. A runtime defect is unnecessary. Compare the proposed caller and owner, and test its preservation claims separately. Confirming the current burden does not certify the suggested refactor as behavior-preserving. Keep unimplemented examples labelled and check ordering, effects and contracts before recommending them.
