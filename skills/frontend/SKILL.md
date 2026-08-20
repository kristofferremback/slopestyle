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

## Visual language

- Build hierarchy with composition, spacing, shape, imagery, and established iconography. Copy carries information; it does not hold the layout together.
- Every visible string must help the user decide or understand something they cannot infer from structure, state, or controls. Cut headings, labels, helper text, and status prose that narrate the obvious.
- Treat visible copy and semantic labels separately. Preserve accessible names, roles, relationships, and landmarks when visible copy is absent. Keep persistent visible labels for data-entry controls; placeholders are examples, not labels.
- Use established icons for familiar actions. Give icon controls accessible names. Add a visible label when the icon would be ambiguous, the action is consequential, or the product term itself matters. Tooltips may supplement a clear control, never rescue an unclear one.
- Audit each string in context and across sibling surfaces. Remove it unless it prevents ambiguity, makes a consequential action explicit, or carries information the user needs. Apply the chosen visual pattern consistently across affected surfaces. If sibling consistency falls outside the task scope, flag it rather than inventing a one-off.

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
