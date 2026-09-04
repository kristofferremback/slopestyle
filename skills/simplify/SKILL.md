---
name: simplify
description: Use when a diff, change, or module is done and needs to be made smaller, or when the user asks to simplify, reduce, or tighten code.
---

# Simplify

Make the change smaller without changing what it proves. The tests that passed before this pass pass after it, unchanged.

## Scope

The diff in front of you, plus any code it made unreachable. Surrounding code stays as it is, even when it invites cleanup.

## Cuts

Apply each and keep only what survives:

- **Deletion test.** Remove a helper, layer, or abstraction. If callers grow no more complex, it stays removed.
- **One caller.** Inline anything called once.
- **Speculative paths.** Delete configuration, flags, adapters, fallbacks, and error handling for situations the accepted scope does not name.
- **Dead code.** Delete unreachable branches, unused parameters, exports nothing imports, and comments that restate the code.
- **Restatement.** Collapse duplicated logic into the one place the codebase already has for it, when that place exists. Do not create one.
- **Naming.** A name says what the thing is. Rename only when the old name misleads.

## Proof

Re-run the same focused tests and type checks that the change ran before this pass. Report the delta in lines and what was removed. A behaviour change, a test edited to pass, or a failing check means the cut goes back.
