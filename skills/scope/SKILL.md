---
name: scope
description: Use when Kris asks to scope work, the intended change is unclear, or growing work needs its scope revisited.
---

# Scope

Establish the intended change and what would count as delivering it.

1. **Recover intent.** Read the request and relevant decisions. State the accepted outcome and constraints, separating them from agent proposals and inherited assumptions. Surface interpretations that would lead to materially different work.
2. **Ground the gap.** Trace the relevant current flow through existing owners to its observable result. Inspect code, history, docs, and tickets as needed; reuse established evidence. Identify what works, what is missing, and which assumptions could change the boundary. Investigate those assumptions and cite concrete evidence, marking what remains unverified. Bound discovery to the scope decisions and first useful slice.
3. **Propose the boundary.** Describe the intended before and after, retained guarantees including required failure behavior, and the smallest coherent work that delivers the complete outcome. Distinguish that outcome from its first useful slice. For inherited work, identify what to retain, rework, remove, or defer against the latest agreement. Keep a sound scope intact; propose reductions for Kris to decide.
4. **Expose tradeoffs.** Give an effort or size hypothesis and its main uncertainty. Justify significant additions by the accepted requirement and why an existing owner cannot serve it. Consider the combined cost of the work. Where a cut or enabling refactor improves delivery, propose its payoff, preserved behavior, and proof. Necessary complexity stays when the outcome requires it.
5. **Define done.** Name observable acceptance evidence for the outcome and first slice. Return a short proposal in conversation covering the intended change, required work, optional improvements, retained guarantees, and proof. Ask only unresolved scope decisions, with a recommendation and material tradeoff, while continuing independent investigation.

Scoping is complete when the intended change, boundaries, retained guarantees, and acceptance evidence are agreed, with no unresolved question that could materially change them. A clear instruction or prior decision supplies that agreement; reuse it. Leave implementation choices to `build` and use `grill` only when Kris explicitly requests the deeper interview.

Return the established scope and evidence to the calling workflow. Standalone scoping ends with the proposal or agreed boundary; continue into `build` when implementation is already authorized. Agreement on scope alone does not authorize implementation or changes to tickets and repository documents.
