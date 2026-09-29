# Assessment guide and review lenses

Answer all three questions at a depth appropriate to the requested scope. For a targeted follow-up, assess the delta's effect on the established answers.

## 1. Are we solving the right problem, with the intended behavior?

Trace a concrete user or operator scenario from its trigger to the expected outcome. Compare the behavior delivered by the change with the accepted requirements, including missing behavior, unnecessary scope, and applicable product surfaces. Ground disagreements in that scenario and those requirements. If the motivation is unclear, identify the assumption and its consequence rather than inventing a new product goal.

## 2. Is this a sensible implementation, including how it fits the existing system?

Explain the mechanism from entry point through state changes to observable outcome. Inspect nearby implementations and established interfaces for prior art. Assess code health and architecture in every review, even when behavior is correct. Apply these checks to the changed responsibilities and their surrounding boundaries:

- **Abstraction quality:** Does the interface express intent and hide implementation decisions? A boundary earns its existence by owning a current concept, invariant, or complexity, even with one caller. Check both missing boundaries and wrappers that merely forward implementation details.
- **Responsibility and cohesion:** Does each function or module own a coherent operation? Identify business decisions mixed with persistence, transport, or presentation, and place new behavior with its rightful owner.
- **Dependency direction:** Trace imports and calls for circular dependencies, lower-level machinery coupled to its callers, and access to another feature's internals. Ground findings in the actual dependency chain and the boundary it compromises.
- **Ownership and change breadth:** Give each rule one owner. Trace a representative change to the affected rule: which modules must change together, and which independently reconstruct the same policy? Distinguish necessary cross-system contracts from avoidable feature sprawl.
- **State and lifecycle:** Inspect hidden mutable state, dependency injection and lifetime ownership, implicit initialization order, and invariants callers must remember to maintain. Check whether state lives at the scope and durability its consumers require.
- **Root-cause repair:** Trace guards, retries, normalization, and fallbacks to the contract that creates the need. Identify speculative handling and downstream workarounds that a repair at the owning boundary would eliminate.
- **Readability:** Can a reader understand the operation through names, types, and meaningful steps? Scrutinize mixed responsibilities, interacting boolean options, and comments that narrate implementation or compensate for unclear structure. Length alone is not a finding.

Ground architectural findings in a concrete structural cost, such as duplicated policy, leaked implementation knowledge, or coordinated edits across unrelated modules. These are valid findings without a reproduced functional defect or an invented future failure. Distinguish observed structure from predicted consequences. Suggest the smallest coherent improvement connected to the change, preserve accepted requirements, and name the tradeoff; keep unrelated redesign outside the review.

State whether the change improves, preserves, or worsens code health and architecture, with source evidence and any unresolved gaps. Explain mixed effects when boundaries improve in one place and deteriorate in another. Correct behavior alone does not establish a sound implementation.

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
