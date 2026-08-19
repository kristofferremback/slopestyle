---
name: ai
description: Use when product or application work adds, changes, reviews, tests, or evaluates model behavior, inference prompts, model context, model tools, routing, settings, or AI features.
---

# AI

Treat AI behavior as experimental. Production and evaluation must exercise the same implementation.

- Keep model, system prompt, context, temperature, toolset, and relevant inference settings overrideable at the production entry point.
- Pass overrides through one typed boundary. Never copy production logic into an eval harness.
- Preserve provider semantics and report unsupported overrides rather than silently dropping or translating them.
- Capture outcomes, trajectories, tool calls, latency, token use, and cost needed to compare experiments.
- Evaluate representative user behavior and failure cases. A passing prompt snapshot is not proof of product quality.
- Keep defaults centralized and observable. Record the exact configuration behind every result.
- Separate deterministic application behavior from probabilistic model behavior so each can be tested honestly.

Load `test` for proof and `frontend` when model behavior changes what users see or control.
