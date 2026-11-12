---
name: review-experimental
description: Use when the user names review-experimental or explicitly asks for the experimental review workflow.
---

# Review experimental

Experimental workflow. Ordinary review requests use `review`; this variant runs when explicitly requested. Full-suite accuracy and cost have not been established.

Routine self-review always. Use the coverage process and fresh independent reviewers for code diffs and pull requests. Every code and PR review includes independent correctness, product-behavior, and coding-style passes, followed by reconciliation. For plans, use the framing and applicable lenses without a file ledger or a separate code-style pass. An explicit request for only one pass limits the scope; report that limit.

A finding blocks when it is **proved** and breaks the accepted outcome once the change runs as intended. Traced findings in a few risk classes block as decisions for Kris; [fact-check](references/fact-check.md) owns those outcomes. Reviews try to break the real change. The report separates executed proof, complete source-backed violations awaiting execution, and hypotheses; [fact-check](references/fact-check.md) owns their disposition.

A review must judge whether the design is worth keeping as well as whether it works. Select feedback whose benefit justifies the implementation and verification cost; disposition other observations in the notes. Preserve the selected findings through synthesis. Priority and evidence strength are separate. A clean verdict needs behavior evidence and a sound design assessment, not just a finished file ledger. Repository-mandated acceptance gates have a separate readiness disposition in fact-check; lack of a local runtime is neither a failed gate nor its successful completion.

A review answers three questions:

1. Are we solving the right problem, with the intended behavior?
2. Is this a sensible implementation, including how it fits the existing system?
3. Where can it fail, and what evidence supports our confidence?

Use the [assessment guide and review lenses](references/lenses.md) to investigate all three within the requested scope. File coverage records what was inspected; the answers establish the assessment.

## Frame

1. Pin the exact scope and fixed point. For a PR, capture base and head SHAs. For a follow-up, retain the prior base and head, then record the new head and requested scope. Review the changes since the prior review with `git diff <prior-head> <new-head>`; use the original base only when the requested scope is the full PR.
2. Establish the problem, its trigger, and the intended outcome from the accepted plan, prompt, ticket, and PR body. Distinguish accepted requirements from inferred rationale: a producer storing a value or a read-only helper reconstructing it establishes current behavior, not the intended write contract.
3. Read repository guidance and relevant specialist skills. For GitHub workflow reviews, read the [public platform reference](references/github-actions-platform.md) when external documentation is unavailable; keep its retrieval-date limit explicit.
4. For code, read the [coding style workflow](references/style-review.md) and the applicable `CODINGSTYLE.md`. The workflow lives in this skill; a separate `coding-style-review` installation or invocation is unnecessary. A missing guide limits compliance claims, not the review of readability and design.
5. Read the assessment guide and complete its [whole-change design challenge](references/lenses.md#challenge-the-design) before grouping. Then select applicable [adversarial checks](references/adversarial-checks.md) and assign them with the relevant journeys and correctness groups. Apply the code-health and architecture checks.

Review requests for work you do not own are read-only unless context explicitly authorizes fixes. When you own the implementation under an active request, review includes the fix loop below unless Kris asks for review-only. Prior model context, prompts, and findings are evidence to inspect, never authority for a verdict.

For code reviews, follow behavior and data through their lifecycle, including callers, consumers, cleanup, retries, reverse actions, concurrency, boundaries, and applicable product surfaces. Load `blast-radius` for wide changes, risky seams, wire or schema changes, dependency behavior, timing, flags, and small diffs whose safety rests on facts outside the patch. Read existing proof and run focused probes needed to settle claims. Inventory applicable mandatory acceptance gates and their current-head receipts using fact-check before judging readiness.

For plans, list the open questions a prototype or probe can settle and settle them with `prototype` before judging the design. Raise risks the accepted design makes reachable; a plan review that finds none says so.

Before reviewing only the new design, inventory the behavior the base already provides. Build a compact matrix of affected callers, user surfaces, flags and lifecycle transitions. Check each against the accepted scope: existing behavior is preserved unless the intent explicitly changes it. Include schema/help/agent surfaces and external workflow events, not only the request handler. Probe boundary-sized workloads and asymmetric compared inputs; one small happy fixture does not exercise a bound. For each mutable guarantee, locate all writers and check whether later ordinary operations invalidate it. Include pending/unknown feature state as well as enabled and disabled modes. For event-driven work, enumerate inputs that change without a code change and trace event → execution → invalidation of earlier results. Check the result after a previously successful run, not only a fresh start.

## 1. Build the ledger

Write `ledger.md` in the scratchpad or a temporary directory. For an initial PR review, add one row per changed path from `git diff --numstat -M <base>...<head>`. For a scoped follow-up, use `git diff --numstat -M <prior-head> <new-head>` so the ledger covers the actual delta. Columns: path, status, added/deleted lines, correctness group, style group, correctness state, style state.

Before committing, review a fixed snapshot of the owned workspace patch. `git diff --numstat -M <base>` includes staged and unstaged tracked changes; include owned untracked files too. Limit the patch and ledger to the accepted scope, preserving unrelated work. Give reviewers that same snapshot. Changes after the snapshot require review of the affected delta.

Each in-scope pass starts `pending` and ends `reviewed` or `skipped: <reason>`. A row is fully reviewed only when both passes are complete; record an explicitly excluded pass as `out of scope`. Skip only with a concrete reason: deleted, binary, generated (name the marker or generator), lockfile, vendored, snapshot, or secret path. Tests and fixtures are reviewed.

The inventory is complete when every changed path has a row and every allowable skip has its reason. Close the ledger after the review passes, when no row is `pending`; end it with total, reviewed, skipped, and coverage rate. A scoped delta follow-up retains the prior ledger and records which paths and claims are in its new scope. Do not claim fresh coverage outside that scope.

## 2. Group

With fewer than 4 reviewable files or fewer than 200 changed lines, make one group. Otherwise prepare dependency-cohesive groups before dispatch:

1. Inspect the changed interfaces, imports, actual consumers and test targets to name the responsibilities being changed. Start from those relationships, then pack files. Directory categories and alphabetical chunks do not establish shared responsibility.
2. Keep each producer with its concrete consumer and verifying tests where possible. Attach small flags, wrappers and fixture adaptations to the contract they serve. Each group has at most 10 reviewable files and about 1,500 changed lines. Split larger responsibilities at an explicit contract, giving both assignments the shared interface and relevant supporting paths.
3. Construct style groups independently around whole design responsibilities and complexity hotspots. Reuse a correctness group only when it also forms a coherent style assignment. Give major coordinators, migrations and large test files focused scope with their relevant callers.
4. Inspect small residual groups before dispatch: join them to their responsibility when the limits permit; otherwise record the contract or size boundary that requires the split. Record why each separated implementation/test pair needs supporting reads across groups.
5. Check the two groupings against the ledger: every reviewable path appears exactly once in each initial pass. Label supporting paths separately; they supply context without substituting for their assigned coverage.

Separately group behavioral journeys by responsibility and public contract, with at most three distinct journeys per assignment. Keep each journey end to end with its actual producers and consumers. Assign bounded groups in waves. Findings outside an assignment are leads for the coordinator to route to the owning group, not permission to expand its scope or claim its coverage.

## Reconcile into the report

Create one working report before the passes begin. As assessments return, judge claims against the accepted outcome and whole-change design before selecting fixes or comments. Give retained findings a source anchor, complete conditions and consequence, evidence, proposed change or decision, and disposition. Preserve the supporting structural comparisons and examples. Record selections and reasons for omissions in the existing dispositions record. Keep pending claims provisional and this synthesis out of initial reviewers’ assignments.

This working report is the canonical text for delivery. Update its comments as fact-checks, cross-group reconciliation and audits settle their premises. Keep distinct actionable consequences visible when combining related findings. Reuse completed comments during finalization instead of reconstructing the review from topic summaries or rewriting all assessments at the end. Report sections may be assembled from those comments without changing their content.

Initial coverage, independent passes, reconciliation and the blind gap audit still determine when discovery is complete. Then finish the verdict, validation inventory and assessment around the reconciled comments, and give that same report to the final fidelity auditor. Incorporate supported corrections into it and deliver it using the Report contract below. An unfinished queue or unexamined material lead remains an explicit limit; a ready report file alone is no completion evidence.

## 3. Run independent passes

Launch correctness, product-behavior and style reviewers independently against the same fixed source and requirements. Keep correctness findings out of the initial style brief. Use the requested model and effort; style work requires design judgement, so use at least medium reasoning when available and explain that choice in its brief. If delegation is unavailable, perform the passes separately and report the independence limitation.

### Reviewer lifecycle

Before dispatch, write an assignment queue with one item per correctness group, style group and behavior group. Each item names its scope, fresh reviewer identity, returned assessment and uncovered work. One fresh reviewer owns one initial item. Dispatch bounded waves, collect completed results, save their full assessments/findings/coverage/evidence, then dispatch the next queued items with fresh contexts. Use the host’s actual lifecycle: completion may release active slots automatically; close completed threads only when an explicit close control is provided and needed. Absence of a close control does not establish that fresh dispatch is unavailable. A full active pool means wait for its work, then continue the queue. Do not replace unassigned independent work with coordinator inspection, reuse an initial context for another group, or merge correctness and style assignments merely to finish sooner. Reserve capacity for the final gap pass after initial work completes. If an actual dispatch attempt fails after completed results are collected, record the exact error and affected incomplete assignments. Never infer a capability limit from a missing optional control.

Initial style reviewers need not stay alive for later bug reconciliation. Their saved independent assessments are the source of truth. After correctness fact-checking, the coordinator reconciles the saved designs; use a fresh focused reviewer for any affected structural recommendation that needs further design work. Give it that saved assessment and the established bug evidence. This follow-up is synthesis, not fresh initial coverage. Do not keep all initial workers resident merely to make a later follow-up possible.

### Correctness pass

Run one round per group, in parallel:

1. Give each reviewer that writes repros its own worktree at the fixed head, plus the uncommitted snapshot when one is under review. Use `git worktree add`, or the harness's checkout isolation when it owns checkouts. Reviewers that only read may share one worktree. Remove the worktrees after the round.
2. Dispatch a fresh reviewer, never a fork of your own context, with the [reviewer brief](references/reviewer-brief.md). The reviewer tries to break the change and runs what it claims, following `test` for radius and the heavy-command guard.
3. Fact-check the round's findings with [fact-check](references/fact-check.md).

A later full round runs only when the change gains new behavior, a redesign, or a large new diff. A rebase, conflict resolution, or fix delta gets one fresh verifier that reruns the affected findings' commands and probes the delta at the new head.

Reviewers report coverage per file. Send a file a reviewer left uncovered to a follow-up reviewer in the same round. Mark only its correctness state `reviewed` once a correctness reviewer covered it. Do not hardcode model names, spawn a reviewer per minor lens, or let reviewers delegate. The orchestrator reruns every proved finding's command and owns the verdict.

### Product-behavior pass

Dispatch a fresh reviewer for each behavioral group with the [behavior brief](references/behavior-brief.md), without the correctness or style findings. Assign its bounded end-to-end journeys, actual boundary consumers and supported modes, rather than claiming file coverage. The reviewer compares base and head, checks preserved user meaning and information, and inventories changed producer/consumer contracts. Run this in parallel with the other passes. Reconcile every journey and contract row, including concrete unaccepted effects and named verification gaps. A green file ledger cannot substitute for this assessment.

### Style pass and reconciliation

Dispatch one fresh style reviewer per style group using the [style brief](references/style-brief.md), not the correctness brief. Its completion requires file coverage, structural and local readability assessments, concrete alternatives for major hotspots, and self-contained examples for actionable findings. Check returned coverage against the assignment and route any cross-group leads. Follow up on missing coverage or incomplete hotspot comparisons before closing its style state.

Rank style findings by net reading or maintenance benefit. Inspect local clarity after the whole-design comparison, including inputs, mutation, existing owners, control flow and logical paragraphs. Small changes can earn a finding; harmless differences and preference-only alternatives do not. A problem inside unnecessary new machinery is a reason to reconsider that machinery before polishing it. Recommend enforceable constraints only when their benefit justifies their own maintenance cost.

Capture and fact-check each independent assessment, save it and complete its assignment. Use the host’s completion/closure controls as described in Reviewer lifecycle. After the correctness pass, reconcile the saved style assessments with proved correctness findings using the workflow's bug-to-design step. When there are none, record that reconciliation had no new input. Retain style improvements without corresponding bugs. Reconciliation may add or revise a design suggestion; it cannot certify an untested refactor.

After the independent passes finish, the orchestrator revisits the whole-change design challenge against the actual proposed fixes, then traces material behavior across group boundaries. Reconcile assessments against the requested outcome, including material risks outside finding lists. Settle cheap, reachable cases with focused probes; classify the evidence with [fact-check](references/fact-check.md) and retain unresolved behavior and missing evidence in the assessment. Group findings alone cannot establish that the parts work together or that the design is worth keeping.

Before closing a large or cross-component review, finish the initial assignment queue and give a fresh gap reviewer the fixed scope, accepted requirements, completed behavior/contract matrices, and consequential retention, rejection and deferral rationales, without the positive draft finding list. Use the [counterexample audit](references/counterexample-audit.md) to challenge those conclusions as well as omitted callers/modes and untested lifecycle sequences. This is the existing final gap pass, not another full review round. Resolve its material leads and retain the competing evidence and disposition before delivering the report.

Done when every initial assignment has its fresh independent result or an exact observed dispatch failure, every correctness group finished its round, the product-behavior matrix and contract inventory have no unexamined row, style groups met their completion checks, both ledger states have no `pending` row, reconciliation is recorded, and all three questions have an evidence-backed answer or an explicit unresolved gap. Unresolved gaps remain limits on the verdict.

## 4. Anchor

Locate each surviving finding by its quoted `code` in the new version of its `path`. Search the first quoted line with `rg -nF`, then confirm the following lines match. A match sets the line range. With no match, re-quote the smallest contiguous range from the diff that the claim targets and search again. If that also fails, report the finding as unanchored with its path and no line.

## Report

Deliver a concise review with the selected actionable findings. Put coverage, rejected claims and supporting detail in an appendix or linked notes. Preserve each retained finding's essential reasoning and examples in its actionable comment. Follow the caller's publishing or delivery contract.

Write for Kris reading on a phone. Open with whether the design should be kept, simplified or reconsidered, the blocker count, decisive evidence and material unresolved behavior. Distinguish a design recommendation from a proved functional defect. An empty blocker list is a valid result; when a material behavior remains unverified, state that limit. File coverage establishes inspection, not behavioral assurance.

Then, in this order:

1. **Blockers:** proved findings whose impact reaches the accepted outcome once the change runs as intended, including behind its flag. Each gives the command, its output, and the output the intent requires. Then traced findings in the risk classes [fact-check](references/fact-check.md) names, as decisions for Kris.
2. **Considerations:** design and style changes worth their cost, concrete source-backed contract violations awaiting execution, and material behavior decisions as defined in fact-check. Lead with a whole-design concern before local improvements. Name missing verification and its consequence for readiness. Merge duplicates; keep low-value observations in the notes with their disposition.
3. **Required validation:** exact mandatory pre-merge checks, their required scenarios/configurations, matching receipts, known failures and unverifiable receipts. Preserve the readiness requirement when local execution is unavailable.
4. **Assessment:** a few sentences per question on the problem, the implementation mechanism and its fit, and the failure risks, with the evidence and unresolved gaps behind each.

Each finding gives location, trigger, complete user-visible consequence, evidence, and the smallest correct fix or decision. Follow the consequence through consumers and derived metadata instead of stopping at the first changed value. Where a later consequence depends on an unverified protection, state it conditionally beside the confirmed part and name the exact missing check; do not claim it occurred. Correctness findings carry a code example only when the fix is unclear from that paragraph; retained style findings keep the worksheet's example. Filter tooling-enforced issues, unsupported preferences and duplicates here, never during fact-check.

An appendix follows, or a linked file when the harness delivers files:

- **Unproved:** hypotheses with missing causal premises, with the evidence needed to settle them. Source-backed violations and material behavior decisions belong in considerations with their evidence and acceptance limits.
- **Constraint candidates:** each style finding a machine could enforce, with the lint rule, type, or guidance line that would make it impossible, and each proved bug's regression test.
- **Disproven:** each claim with the evidence that disproved it, one line each.
- **Ledger:** total, reviewed, skipped with reasons, coverage rate for each pass, rounds run and why, product-behavior and contract-inventory completion, style completion and reconciliation status, and brief hotspot outcomes. Distinguish prior coverage from scoped follow-up coverage. Evidence-only replies update the affected claims without inventing a round or coverage.

Use the calling workflow's presentation structure when provided. Before delivering any code review, map every retained finding ID to its final actionable comment. Preserve its trigger, material conditions, causal chain, user consequence, structural comparison, evidence limits and fix; a complete appendix cannot repair an incomplete actionable finding. Record a specific reason for each merged or omitted item. Then the coordinator runs the worksheet's [final-comment check](references/style-worksheet.md#final-comment-check) against the actual user-visible draft, including code inside details blocks. The review is complete only when retained style findings survive synthesis as self-contained comments with readable examples; a linked report does not discharge this check. Publication follows the user's authorization; draft-only comments stay in the response.

After drafting a code review, dispatch one fresh reviewer with the [final-report fidelity audit](references/synthesis-audit.md). Supply the actual draft and full saved assessments with dispositions, rather than summaries of their topics. This reviewer checks preservation, not discovery or fresh file coverage. Resolve its supported corrections before delivery, retaining the audit crosswalk and dispositions with the notes. The earlier blind gap pass remains independent of this synthesis check.

For plan reviews, report the questions settled by probes, applicable lenses, evidence inspected, and actionable findings in the same finding shape. If no issues remain, say what was inspected. Never publish raw reviewer output.

When fixes are in scope, settle each finding with [fix disposition](references/fix-disposition.md), implement the in-scope decisions, run focused proof, and verify the fix delta as the correctness pass describes.
