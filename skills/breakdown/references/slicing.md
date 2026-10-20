# Slicing

A slice is a unit of delivery: one ticket tracks it, one PR or a short stack reviews it. Give each slice a focused review goal and a reason to land independently while the complete set delivers the accepted outcome.

## Vertical slice

The default. A slice is a tracer bullet: one representative behavior through every layer it touches, landing on the surface a user exercises and proved there. Its migration, contract, endpoint, and UI travel together. The first slice is the thinnest path a user can exercise; later slices widen the behavior.

Every slice proves something a user or operator can exercise. Order slices so the assumption most likely to change the plan is proved first. A slice too large for one implementer session becomes a thinner path plus widening slices.

`migrate` orders expand and contract deploys inside a slice. The schema is part of the slice that first reads or writes it.

## Sample then build

Use for broad refactors or shared mechanisms. Introduce the new path through one representative real use. Review that mechanism deeply, then roll it out broadly in follow-ups reviewed for completeness. When the rollout spans many callers, expand first, migrate callers in batches that each stay green, and contract once no caller remains; each batch is its own slice.

## Refactor first

Keep an agreed enabling refactor separately reviewable from the behavior it enables, usually as a preceding commit in the same slice. Prove preserved behavior at that intermediate step before adding new behavior. Use a prerequisite slice when the refactor's reach, such as shared infrastructure or many unrelated callers, makes preservation a review question of its own. The existing behavior it preserves is what a reviewer exercises.

## Boundary test

A boundary holds when a reviewer can exercise what the slice delivers and answer one review question. Splits by layer, by file count, or into scaffolding with no independent value fail that test, as do slices whose only proof arrives with a later slice. Approval, verification, and cleanup travel inside the slice they gate. A dependent slice may rely on its parent, but it still needs a coherent review question and its own proof.
