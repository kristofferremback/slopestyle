---
name: prototype
description: Use when the user asks for a prototype, mock, spike, proof of concept, UI alternatives, or a cheap executable answer to one design question.
---

# Prototype

A prototype is disposable code that answers one named question.

1. State the question, assumption, and observable success signal.
2. Choose the smallest artifact that can answer it. Logic prototypes expose hard state transitions; UI prototypes load `frontend` and compare meaningfully different options.
3. Mark it clearly as throwaway. Isolate state, avoid production persistence, and skip tests, abstractions, and polish that do not help answer the question.
4. Make it trivial to run and show the relevant state after each action.
5. Publish through `seer` when a browser artifact helps Kris compare or drive it from his phone.
6. Record the answer outside main. Delete the prototype after the decision. Keep a throwaway branch only when it remains useful primary evidence.

A prototype never quietly becomes production code. Build the validated decision cleanly through `build`.
