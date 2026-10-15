---
name: scope
description: Use when Kris asks to scope work, the intended change is unclear, or growing work needs its scope revisited.
---

# Scope

Agree the intended change and what counts as delivering it.

1. **Ground it.** Trace current behavior through its existing owners to the observable result. Separate what Kris accepted from assumptions, inherited or your own, and check those that could move the boundary.
2. **Draw the boundary.** State the before and after, the guarantees the change keeps, and the smallest coherent work that delivers the complete outcome, with its first useful slice. Necessary complexity stays; cuts are Kris's call.
3. **Price it.** Give an effort hypothesis and its main uncertainty. Bring Kris each open scope decision with a recommendation and its material tradeoff.
4. **Define done.** Name the observable evidence that proves the outcome and the first slice.

Scope is settled when no open question could materially change the boundary. A clear instruction or prior decision already settles it; reuse it.

Return the agreed scope and evidence to the caller. Scoping alone authorizes nothing further; continue into `build` only when implementation is already authorized.
