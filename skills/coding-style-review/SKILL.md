---
name: coding-style-review
description: Use when asked to review code against CODINGSTYLE.md, or to perform the coding-style pass within a larger review.
---

# Coding Style Review

Read the guide, understand the selected code line by line, and suggest changes that make it easier to understand and change. Be picky without being annoying. Software should be beautiful.

Focus on **how the code is written**, not functional correctness; assume another review owns that. Scrutinize naming, formatting, function balance, abstractions, ownership, state models and test design even when behavior is correct. A concrete improvement in clarity or maintainability earns a finding without a runtime defect. Hand incidental bugs to the correctness review without turning this pass into bug hunting.

## Establish the assignment

Identify the selected files, module or diff and the requested deliverable. Honor an explicit mode; otherwise verify authorship from PR metadata and session context:

- **Suggest:** another author's PR, or uncertain ownership. Give actionable comments without modifying their branch.
- **Apply:** Kris's PR, including work authored by an agent for him. Implement, verify and push in-scope improvements directly. A specific read-only request overrides this default. Ownership of the repository alone does not establish ownership of the PR.
- **Offer a commit:** for a bounded improvement to another author's PR, optionally prepare a separate, verified commit they can cherry-pick. Follow [Applying findings](references/applying-findings.md) for its isolation and publication rules. This never authorizes writing to their PR branch.

Use the [Review worksheet](references/review-worksheet.md) to make the scope, significance, expected benefit and evidence explicit. State the selected mode before work begins; missing ownership evidence falls back to suggestions rather than blocking the review.

Read the applicable repository guidance and `CODINGSTYLE.md`, using a supplied guide when specified. If the guide is unavailable, report that limitation and distinguish observations from claims of compliance. The guide owns style rules; this skill owns the process.

Within a larger review, share its scope, coverage record and report. Its `review` workflow owns independent review and fact-checking.

## Understand before proposing

Inventory the scope and read every source, test and fixture in full. For a diff, read each changed file and its relevant context. Record unread paths and reasons, including generated or vendored exclusions. Sampling key files is not a complete module review.

Trace callers, dependencies and data through their lifecycle: contracts, effects, transactions, retries, resource ownership and test assumptions. Record where understanding is hardest and why before proposing edits.

Apply every relevant guide section, including the small details. Record findings or grounded retentions for the applicable areas; reading the guide and listing covered files alone does not complete the pass. Prioritize change amplification, cognitive load and hidden prerequisites.

## Propose coherent changes

For each finding, show the source location, concrete cost, guide principle and smallest coherent change. For structural findings, trace the burden to actual callers: what do they currently have to know? If a function already owns a coherent operation, a new container or name needs a specific improvement beyond relocation. Name the knowledge or guarantee its owner should contain and what callers can stop knowing.

Judge contracts and workflow together. Length and helper counts are not targets. Retain a clear branch or operation followed by persistence when an invariant justifies it. A shorter caller that still supplies recovery policy and bookkeeping callbacks may remain equally complex.

Make each actionable finding understandable to an author who has never read `CODINGSTYLE.md`. Embed a compact example of what good looks like and explain why it improves the code; naming a principle or linking the guide is insufficient. A one-line replacement can illustrate a small finding; use before/after snippets for substantial recommendations. Ground examples in the reviewed code, label proposals or schematic omissions, and preserve ordering, effects and contracts. For ownership changes, show enough of the owner's logic to demonstrate where the cost is removed. Include the example in the review comment itself, not only a separate report. Group related findings by ownership change and drop tool-enforced nits.

For substantial findings with useful supporting detail, use the worksheet's [expandable comment format](references/review-worksheet.md#expandable-comments).

## Fit recommendations to the change

For a diff review, compare with the base: was each issue introduced or worsened here, or does it predate the change? Recommend fixing what this change introduced or worsened here, and existing issues when the refactor is small and directly connected to the changed code. State the evidence and expected reach of the fix.

Before deferring a broader pre-existing problem, ask whether a **behavior-preserving refactor first** would make this change smaller and safer, even if it touches code outside the diff. Show what duplication, special cases or scattered edits would disappear, and what becomes easier to verify. Judge the combined refactor and feature change; shrinking the feature diff alone is insufficient.

Present this as a friendly option: “Could we first simplify the existing workflow so this change only needs to add the new case?” Suggest two reviewable steps: preserve and reorganize existing behavior, then add the feature. These can be separate commits here or a prerequisite PR. Explain the concrete payoff without making architectural cleanup an automatic blocker.

Otherwise, propose a minimal local improvement that moves toward the intended design, then describe the larger refactor as a **non-blocking follow-up**. If no useful local step exists, say so rather than adding an intermediate abstraction. For a whole-module assignment, use the agreed module scope instead of inventing a diff boundary.

## Use correctness findings as design evidence

When both passes are requested, prefer independent parallel reviews followed by a style revision using the correctness findings. The coordinating workflow owns delegation. If correctness findings already exist, use them without waiting for another run; a standalone style review needs no correctness pass.

For each supplied bug, ask: **Can we define this bug away so it can't happen again?** Consider whether a state model, interface or responsibility boundary can make the invalid state unrepresentable or own the missing guarantee. For example, replacing independent `kind` and optional `schema` fields with a discriminated union can require a schema for the prepared case. Explain exactly which failure becomes impossible and where runtime validation is still needed. Keep a straightforward bug fix when a redesign adds no useful guarantee. Revise or add style findings using the same scope rules, preserving independent style findings even when they have no corresponding bug.

## Audit responsibility before finishing

Revisit every major complexity hotspot identified during reading. For the proposed design, or the actual code after fixes, answer:

> Which protocols, policies and persistence guarantees does the caller no longer need to understand—and why does each remaining responsibility belong there?

Inspect both caller and owner bodies. Account for each remaining mixed responsibility with an in-scope change, a justified retention or an explicitly deferred follow-up. Review-only work records the recommendation; authorized fixes must satisfy this check in the actual implementation within the agreed scope.

When fixes are authorized, continue with [Applying findings](references/applying-findings.md).

## Return a useful result

Lead with whether meaningful changes are needed and why. Distinguish **fix here**, **refactor first**, and **non-blocking follow-up** recommendations. Prioritize by design and readability benefit, distinguish facts from uncertainty, and include examples, justified retentions and coverage gaps. A clean style result makes no claim about functional correctness. Allow it when the code already fits the guide.

For completed fixes, explain what callers no longer need to know, what behavior changed and what was verified.
