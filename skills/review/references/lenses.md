# Review lenses

Select lenses based on the change. Do not run every lens by habit.

- **Intent and scope:** matches the accepted outcome without missing behavior or speculative work.
- **Correctness:** state transitions, edge cases, error paths, reverse actions, and cleanup.
- **Data lifecycle:** creation, transformation, persistence, transport, retries, cancellation, deletion, and races.
- **Contracts:** schemas, APIs, wire formats, versions, compatibility, and one source of truth.
- **Architecture:** complexity is contained, interfaces earn leverage, seams are real, and readers can follow ownership.
- **Security and privacy:** trust boundaries, authorization, secrets, destructive actions, and data exposure.
- **Failure:** operations are atomic and retryable, fallbacks are explicit, and blast radius stays contained.
- **Product and UX:** user goal, prior art, accessibility, spatial stability, navigation, theme, and every applicable surface.
- **Mobile:** touch, keyboard, screen reader, viewport, back behavior, and full feature capability.
- **Operations:** rollout, observability, migration activation, resource lifetimes, and proof in production.
- **Tests:** behavior at the highest practical layer, meaningful assertions, honest green state, and earned regression coverage.
