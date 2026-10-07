# Coding style pass

Assume the code works: how could it become substantially easier to understand and change? Read the guide, understand the selected code line by line, and demonstrate better designs. Be picky without being annoying. Software should be beautiful.

Focus on **how the code is written**, not functional correctness; assume another review owns that. Scrutinize naming, formatting, function balance, abstractions, ownership, state models and test design even when behavior is correct. A concrete improvement in clarity or maintainability earns a finding without a runtime defect. Hand incidental bugs to the correctness review without turning this pass into bug hunting.

## Establish the assignment

Within a combined review, inherit its scope, mode and publication limits. A delegated reviewer always works read-only and returns findings to its coordinator. For a standalone style review, identify the selected files, module or diff and the requested deliverable. Honor an explicit mode; otherwise verify authorship from PR metadata and session context:

- **Suggest:** another author's PR, or uncertain ownership. Give actionable comments without modifying their branch.
- **Apply:** Kris's PR, including work authored by an agent for him. Implement, verify and push in-scope improvements directly. A specific read-only request overrides this default. Ownership of the repository alone does not establish ownership of the PR.
- **Offer a commit:** for a bounded improvement to another author's PR, optionally prepare a separate, verified commit they can cherry-pick. Follow [Applying findings](style-fixes.md) for its isolation and publication rules. This never authorizes writing to their PR branch.

Use the [Review worksheet](style-worksheet.md) to make the scope, significance, expected benefit and evidence explicit. State the selected mode before work begins; missing ownership evidence falls back to suggestions rather than blocking the review.

Read the applicable repository guidance and `CODINGSTYLE.md`, using a supplied guide when specified. If the guide is unavailable, report that limitation and distinguish observations from claims of compliance. The guide owns style rules; this skill owns the process.

Within a larger review, share its scope and inventory while retaining a distinct style assessment. Its `review` workflow owns delegation and fact-checking; the style pass owns its design criteria and completion check below. A demonstrated reading or maintenance burden is evidence for a style finding, including a non-blocking one.

## Understand before proposing

Inventory the scope and read every source, test and fixture in full. For a diff, read each changed file and its relevant context. Record unread paths and reasons, including generated or vendored exclusions. Sampling key files is not a complete module review.

Start with the complexity hotspots. Rank the largest changed files and functions alongside mixed responsibilities, repeated policies, nested cases, mutable bookkeeping and opaque test setup. Size directs attention; the responsibilities and reading burden establish the problem. Record each hotspot's location and concrete friction before proposing edits, then complete the rest of the scope.

When delegating, give each major hotspot a focused assignment with its relevant callers and tests. Keep a large coordinator or migration out of a catch-all style assignment spanning the entire PR. Use the requested model and effort; structural design comparisons need reasoning capacity appropriate to that task.

Trace callers, dependencies and data through their lifecycle: contracts, effects, transactions, retries, resource ownership and test assumptions.

Apply every relevant guide section. After assessing structure, read the code again for local readability: logical paragraphs, names, expressions, conditions and visible test phases. Blank lines that separate setup, decisions, effects and assertions express meaning; they are reviewable even when the formatter passes. Record findings or grounded retentions for both structural and local readability; a structural recommendation does not discharge the local pass.

## Propose coherent changes

For each finding, show the source location, concrete cost, guide principle and smallest coherent change. Inspect complexity at both levels: what callers must know, and what a maintainer must hold in mind inside the implementation. A simple public interface can hide an internally tangled module. A coherent use case may still mix several responsibilities; identify which decisions and representations each internal operation should own. One caller is enough when the boundary makes the body easier to understand.

For every major hotspot, map its responsibilities and develop a concrete alternative: a clearer local expression, a domain operation that owns its details, a better state representation, or a simpler test arrangement. Sketch the resulting caller and enough owner logic in your working notes to compare real designs, including when retaining the original. Assess the whole hotspot as well as local duplication: a small helper can be useful without resolving the surrounding mixed responsibilities. Show what the reader must track before and after. Necessary complexity still needs an appropriate home.

Judge contracts and workflow together. Keep a clear branch or operation followed by persistence when it communicates the domain well. Prefer an extraction when its interface contains the decisions and bookkeeping that currently distract its caller. Evaluate total understanding cost across caller and owner, not caller length.

Make each actionable finding understandable to an author who has never read `CODINGSTYLE.md`. Embed a focused example of what good looks like and explain why it improves the code; naming a principle or linking the guide is insufficient. Format examples as production code, preserving logical blank lines and clear setup/execution/assertion groups. Reduce their scope rather than compress their layout. A one-line replacement can illustrate a small finding; use before/after snippets for substantial recommendations. Ground examples in the reviewed code, label proposals or schematic omissions, and preserve ordering, effects and contracts. For ownership changes, show enough of the owner's logic to demonstrate where the cost is removed. Include the example in the review comment itself, not only a separate report. Group related findings by ownership change and drop tool-enforced nits.

For substantial findings with useful supporting detail, use the worksheet's [expandable comment format](style-worksheet.md#expandable-comments).

## Fit recommendations to the change

For a diff review, compare with the base: was each issue introduced or worsened here, or does it predate the change? Recommend fixing what this change introduced or worsened here, and existing issues when the refactor is small and directly connected to the changed code. State the evidence and expected reach of the fix.

Before deferring a broader pre-existing problem, ask whether a **behavior-preserving refactor first** would make this change smaller and safer, even if it touches code outside the diff. Show what duplication, special cases or scattered edits would disappear, and what becomes easier to verify. Judge the combined refactor and feature change; shrinking the feature diff alone is insufficient.

Present this as a friendly option: “Could we first simplify the existing workflow so this change only needs to add the new case?” Suggest two reviewable steps: preserve and reorganize existing behavior, then add the feature. These can be separate commits here or a prerequisite PR. Explain the concrete payoff without making architectural cleanup an automatic blocker.

Otherwise, propose a minimal local improvement that moves toward the intended design, then describe the larger refactor as a **non-blocking follow-up**. If no useful local step exists, say so rather than adding an intermediate abstraction. For a whole-module assignment, use the agreed module scope instead of inventing a diff boundary.

## Use correctness findings as design evidence

When both passes are requested, first capture an independent style assessment, then supply correctness findings for reconciliation. The coordinating workflow owns delegation and keeps bug lists out of the initial style brief. If bugs are already in context, record the independent design assessment before reconciling them; a standalone style review needs no correctness pass.

For each supplied bug, ask: **Can we define this bug away so it can't happen again?** Consider whether a state model, interface or responsibility boundary can make the invalid state unrepresentable or own the missing guarantee. For example, replacing independent `kind` and optional `schema` fields with a discriminated union can require a schema for the prepared case. Explain exactly which failure becomes impossible and where runtime validation is still needed. Keep a straightforward bug fix when a redesign adds no useful guarantee. Revise or add style findings using the same scope rules, preserving independent style findings even when they have no corresponding bug.

## Audit responsibility before finishing

Revisit every major complexity hotspot identified during reading. For the proposed design, or the actual code after fixes, answer:

> Which protocols, policies and persistence guarantees does the caller no longer need to understand—and why does each remaining responsibility belong there?

Inspect both caller and owner bodies. Close each hotspot with a concrete recommendation, a deferred follow-up, or a retention explaining why the current design beats the specific alternative considered. Base retention on the concrete comparison. A navigation step is justified when its name and contract let the reader understand one responsibility at a time; evaluate that benefit against the interface and knowledge it adds. Account for each remaining mixed responsibility. Review-only work records the recommendation; authorized fixes must satisfy this check in the actual implementation within the agreed scope.

When fixes are authorized, continue with [Applying findings](style-fixes.md).

## Return a useful result

Lead with whether meaningful changes are needed and why. Distinguish **fix here**, **refactor first**, and **non-blocking follow-up** recommendations. Prioritize by design and readability benefit, distinguish facts from uncertainty, and include examples, justified retentions and coverage gaps. Include a brief disposition of the major hotspots, including retained ones, so their assessment survives synthesis with correctness findings. A clean style result makes no claim about functional correctness; earn it through the concrete comparisons above. Findings have no quota.

For completed fixes, explain what callers no longer need to know, what behavior changed and what was verified.
