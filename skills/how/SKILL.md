---
name: how
description: Use for how-does-this-work questions, code walkthroughs, runtime flow, ownership, placement, layering, and subsystem mental models.
---

# How

Trace actual code from trigger to effect and give a working mental model, not annotated source.

- Treat the question as read-only unless context clearly authorizes changes.
- State the interpreted scope and proceed so Kris can redirect without blocking.
- For a narrow module, explore directly. For a real subsystem, split 2 to 4 read-only exploration angles with distinct ownership, then synthesize.
- Follow entry points, calls, data, state, boundaries, side effects, cleanup, and output. Read code rather than inferring from names.
- Cite concrete files and symbols. Mark gaps and contradictions instead of guessing.
- Scale the answer to the question. Use overview, key concepts, flow, location map, and gotchas only when each helps.

Use `why` for historical motivation and `review` for adversarial architectural critique.
