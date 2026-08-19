---
name: why
description: Use for why-was-this-built questions, design rationale, postmortems, tradeoffs, historical constraints, unexplained thresholds, and decision archaeology.
---

# Why

Investigate intent from evidence. Code shows what exists, not necessarily why.

1. Anchor the target in exact files, symbols, blame, commits, and linked PRs.
2. Search relevant primary records: source history, tickets, long-form docs, Threa, observability, error tracking, and product analytics. Scale coverage to the question. Report unavailable or intentionally skipped sources.
3. Search in parallel when evidence categories are independent. Keep raw payloads out of the main context.
4. Prefer direct quotes and links. Surface contradictions and null results. Never retrofit a satisfying story onto thin evidence.
5. Verify citations and current state before synthesis.

Separate the result into direct evidence, reasonable inference, competing hypotheses, and unknowns. Every claim about intent needs a source or an explicit inference chain.

If implementation follows, finish with:

- **Preserve:** constraints still carrying value
- **Change:** evidence that supports a new direction
- **Avoid:** failed or rejected approaches
- **Risk:** uncertainty and proof still needed

Questions remain read-only unless context clearly authorizes changes.
