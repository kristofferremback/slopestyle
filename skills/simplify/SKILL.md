---
name: simplify
description: Use when a diff, change, or module is done and needs to be made smaller, or when the user asks to simplify, reduce, or tighten code.
---

# Simplify

Make the change smaller while preserving accepted behavior and existing guarantees it must retain. Use the accepted scope to distinguish required behavior from speculative additions. When that distinction is uncertain, retain the behavior and propose the cut.

## Scope

The diff in front of you, plus any code it made unreachable. Surrounding code stays as it is. Report simplifications beyond it, such as an abstraction that would collapse surrounding code, as proposals for Kris.

## Cuts

Apply each and keep only what survives:

- **Deletion test.** Remove a helper, layer, or abstraction. If callers grow no more complex, it stays removed.
- **Pass-through.** Inline a single-caller helper that only forwards, renames, or wraps. A function that owns a named concept or invariant stays.
- **Speculative paths.** Delete additions that no accepted requirement or retained guarantee needs, including their configuration, adapters, fallbacks, and error handling. A requirement may need failure handling without spelling out each case.
- **Dead code.** Delete unreachable branches, unused parameters, exports nothing imports, and comments that restate the code.
- **Restatement.** Collapse logic the change repeats into one owner: the codebase's existing one when it exists, otherwise a new one beside its callers. Fewer lines across all callers beats a smaller diff.
- **Naming.** A name says what the thing is. Rename only when the old name misleads.

## Proof

Load `test` to select focused checks and reuse valid evidence. After a cut, rerun the checks it invalidates; when no cut is justified, report that outcome without rerunning unchanged green checks. Report what was removed and the delta in lines, with no minimum reduction target.

Preserve coverage of required behavior. A cut may retire tests this change added solely for a removed speculative path; identify each retired test and why no required guarantee relies on it. A cut that changes required behavior, weakens its assertions, or leaves a failing check goes back.
