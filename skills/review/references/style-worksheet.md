# Review worksheet

Use this working template with the [style pass](style-review.md). Keep the review comments short; retain coverage and supporting evidence in the shared review notes.

## Run the pass

1. **Frame:** record mode, reviewed base/head or module scope, guide path, authorship evidence and requested deliverable.
2. **Read:** inventory and understand the scope as the [style pass](style-review.md) requires. Record concrete friction before proposing solutions. Account for each applicable guide area with findings, grounded retentions or an explicit coverage gap.
3. **Design:** complete the finding template below. Compare the smallest local improvement with any broader refactor; select the one whose benefit justifies its reach and verification cost.
4. **Reconcile:** when correctness findings are supplied, reconsider whether a design change could eliminate the reported failure. Preserve findings about readability and maintenance independently.
5. **Verify:** inspect the proposed caller and owner together. In apply or offer-commit mode, implement and check the result using Applying findings. In suggest mode, distinguish source reasoning from unimplemented or untested proposals.
6. **Deliver:** report fixes here, refactor-first options and non-blocking follow-ups, then apply the [final-comment check](#final-comment-check) below. For implemented work, include the actual delta and observed proof.

## Calibrate significance

Scale reflects responsibility and risk, not a line-count threshold. A tiny diff can alter a public contract; a larger mechanical edit may preserve one.

| Scale      | Typical reach                                                                                         | What earns the change                                                                                                  | Proportionate verification                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | Naming, expression structure, a focused test, or one function; responsibility and contracts stay put. | A specific ambiguity, repetition or reading detour disappears.                                                         | Inspect affected uses; run applicable format/type checks and focused behavior checks when execution is affected.                        |
| Structural | Ownership, state representation, module boundaries or several callers change.                         | Callers stop knowing a protocol, invalid combinations disappear, or one change no longer requires scattered edits.     | Compare caller and owner bodies, trace all affected callers, preserve contracts, and exercise affected behavior and failure boundaries. |
| Broad      | Shared infrastructure, unrelated callers, public contracts, storage or rollout concerns.              | Demonstrable reduction in the combined refactor and feature complexity that outweighs migration and verification work. | Map affected consumers and prove preserved behavior separately from the feature. Propose first when it exceeds the agreed scope.        |

A structural change is worthwhile only when you can show the removed burden and explain why a smaller edit is insufficient. Moving lines, adding layers, shortening a coordinator or counting passing tests alone does not establish improvement. Behavior-changing repairs are distinct from behavior-preserving refactors.

## Finding template

- **Suggestion:** friendly, specific recommendation and source location.
- **Origin and disposition:** introduced/worsened here or pre-existing, with base evidence; fix here, refactor first or non-blocking follow-up.
- **Scale and cost today:** affected responsibilities/callers and the concrete reading, maintenance or testing burden.
- **What good looks like:** compact proposed code and explanation, following the [style pass](style-review.md)'s example requirements.
- **Why worth it:** what callers stop knowing, edits or special cases that disappear, and why a smaller alternative is insufficient. For refactor-first proposals, consider the combined work.
- **Preservation and proof:** behavior/contracts to retain, how to verify them, what was actually checked and what remains uncertain.
- **Delivery:** suggestion, direct fix or optional commit; identify any broader work as a separate proposal.

Combine these into natural prose in author-facing comments. Small findings may need only a few sentences and a one-line replacement. Substantial proposals need enough evidence to assess the tradeoff; the template is not a requirement to pad every comment.

## Place comments on the code

When publishing the review is authorized, prefer inline PR review comments attached to the relevant code over a report that merely references line numbers. Anchor each finding to the smallest useful line range at the reviewed revision. Use a native code-suggestion block for an exact, safe replacement when the review tool supports it; show broader refactors with the examples below.

If inline placement is unsupported or the finding spans the overall design, use a self-contained review comment with precise file/line references. Recheck locations if the head changes. Keep draft-only requests as drafts, and report publication failures honestly. This means review annotations, not adding reviewer notes to source files.

## Expandable comments

For substantial findings, keep a self-contained suggestion visible and put optional depth in a collapsed `<details>` block. The visible part states the improvement, benefit and disposition, shows a compact example, and includes required constraints, behavior changes and unresolved risks. Opening the details should deepen understanding without changing the recommendation.

Use this shape, replacing the placeholders with concrete content:

```markdown
**Suggestion — [fix here / refactor first / non-blocking follow-up]: [improvement]**

[Friendly recommendation, concrete benefit and compact code example.]
[Essential constraints and risks, if any.]

<details>
<summary>Expanded example and reasoning</summary>

[Fuller before/after sketch, affected callers, alternatives and verification approach.]
[Label illustrative code and omitted details; distinguish observed checks from proposed checks.]

</details>
```

Both examples must express the same design. Label sketches as illustrative implementations to adapt to existing conventions, so incidental details do not become requirements. Agents reading raw Markdown still receive the expanded text; collapse improves human scanning, not context usage. Keep small suggestions small and omit the block when it adds no useful context.

## Final-comment check

The coordinator owns the delivered comments, even when reviewers supplied good examples. Apply this check after merging findings and reconciling correctness, to the actual response or comments about to be sent.

1. **Account for findings.** Map each retained style finding to its final comment. Merge duplicate findings with their useful examples and constraints; record reasons for omissions in the review notes. Supporting reports hold coverage and extra evidence, not missing recommendations.
2. **Make each comment usable alone.** Include its anchor, friendly suggestion, concrete benefit, scope disposition and a focused code example. Use the latest reconciled example, adapting the reviewer's readable code rather than rewriting it into compressed shorthand. A substantial recommendation shows before/after or caller/owner logic; put the longer example in the same comment's `<details>` block. Links supplement these examples.
3. **Review the examples as code.** Apply `CODINGSTYLE.md` to every delivered code block, including collapsed blocks. Preserve normal statement, field and JSX formatting, logical blank lines, and visible setup/execution/assertion phases. Shorten prose or narrow an example's scope to control length; keep its layout readable. A naturally one-line replacement stays small.
4. **Preserve meaning.** Keep ordering, effects, deciding test inputs and necessary owner logic visible. Carry behavior caveats above the fold, label schematic omissions, and distinguish proposed checks from executed evidence. Reconciliation must update examples that a correctness finding invalidated.
5. **Read the final draft as its recipient.** Can the author understand and act on each suggestion without opening a report or the style guide? Can they see both the design improvement and its limits? Completion requires yes for every retained comment. A presentation-only revision reuses the established findings and proof; it does not restart review rounds or tests.
