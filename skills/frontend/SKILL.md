---
name: frontend
description: Use before planning or editing product UI, frontend components, styling, interaction, navigation, accessibility, responsive behavior, or mobile behavior.
---

# Frontend

Build feature-complete product behavior for every applicable surface. Start from the user's job and existing product language, not implementation convenience.

## Before design

- Inspect nearby product flows, components, tokens, copy, and repository surface matrices.
- Reuse established primitives unless evidence shows a real gap.
- Identify desktop, mobile, keyboard, screen-reader, dark-mode, light-mode, loading, empty, error, and reverse-action behavior that applies.
- For a novel interaction with no prior art, use `prototype` to compare meaningfully different options before production code.

## Interaction contract

- Mobile is the full product. No hover-only requirements, tiny touch targets, or reduced capability unless requested.
- Links navigate and buttons act. Keep browser, keyboard, and assistive behavior native.
- Navigable state lives in the URL. Opening an overlay pushes history; mobile Back and desktop Escape dismiss it; direct closure pops rather than adding history.
- Keep controls in stable positions and footprints. Reserve delayed space or add new controls without shifting existing ones.
- Batch related user-facing state into one coherent result. Do not make users watch internal sequencing.
- Success is silent when the UI already shows it. Confirm copy and downloads in place. Reserve toasts for failure, warnings needing action, and deferred or offline state.
- Render dates and times in the timezone users expect.

## Component boundaries

UI components display data, own local interaction state, and dispatch actions. Business logic, persistence, and data access stay outside the render tree. Keep private named subcomponents in the same file when they make complex UI easier to read; define them at module scope.

The backend returns structured content and stable error codes. The UI owns what users read.

## Proof

Load `test`. Verify observable behavior at the highest practical layer and every applicable surface. Check touch, keyboard, screen reader, viewport, theme, navigation history, loading stability, and failure containment. Never accept a white-screen crash.
