# Assessment guide and review lenses

Answer all three questions at a depth appropriate to the requested scope. For a targeted follow-up, assess the delta's effect on the established answers.

## 1. Are we solving the right problem, with the intended behavior?

Trace a concrete user or operator scenario from its trigger to the expected outcome. Compare the behavior delivered by the change with the accepted requirements, including missing behavior, unnecessary scope, and applicable product surfaces. Ground disagreements in that scenario and those requirements. If the motivation is unclear, identify the assumption and its consequence rather than inventing a new product goal.

## 2. Is this a sensible implementation, including how it fits the existing system?

Explain the mechanism from entry point through state changes to observable outcome. Inspect nearby implementations and established interfaces for prior art. Assess ownership, where complexity lives, reuse, and whether the design adds avoidable coupling or duplicates behavior. Suggest a simpler alternative when it preserves the accepted requirements and removes a concrete cost; name the tradeoff. Architectural findings need a consequence, not a style preference.

## 3. Where can it fail, and what evidence supports our confidence?

Follow the material behavior through its lifecycle, including boundaries outside the changed files. Select applicable lenses below and investigate concrete failure scenarios. Tie confidence to inspected source, existing tests, or focused probes. State what those checks establish and what remains unproved, even when no defect is found.

- **Correctness:** state transitions, edge cases, error paths, reverse actions, and cleanup.
- **Data lifecycle:** creation, transformation, persistence, transport, retries, cancellation, deletion, and races.
- **Contracts:** schemas, APIs, wire formats, versions, compatibility, and one source of truth.
- **Security and privacy:** trust boundaries, authorization, secrets, destructive actions, and data exposure.
- **Failure:** operations are atomic and retryable, fallbacks are explicit, and blast radius stays contained.
- **Product and UX:** user goal, prior art, accessibility, spatial stability, navigation, theme, and every applicable surface.
- **Mobile:** touch, keyboard, screen reader, viewport, back behavior, and full feature capability.
- **Operations:** rollout, observability, migration activation, resource lifetimes, and proof in production.
- **Tests:** behavior at the highest practical layer, meaningful assertions, honest green state, and earned regression coverage.
