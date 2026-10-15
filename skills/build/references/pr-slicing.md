# PR slicing

A PR is a review unit. Give each one a focused review goal and a reason to land independently while the complete stack delivers the accepted outcome.

## Vertical slice

The default. A slice is a tracer bullet: one representative behavior through every layer it touches, landing on the surface a user exercises and proved there. Its migration, endpoint, and UI travel together. The first slice is the thinnest path a user can exercise; later slices widen the behavior.

`migrate` orders expand and contract deploys inside a slice. The schema is part of the slice that first reads or writes it.

## Sample then build

Use for broad refactors or shared mechanisms. Introduce the new path through one representative real use. Review that mechanism deeply, then roll it out broadly in a follow-up reviewed for completeness.

## Refactor first

Keep an agreed enabling refactor separately reviewable from the behavior it enables, usually as a preceding commit in the same slice. Prove preserved behavior at that intermediate step before adding new behavior. Use a prerequisite PR when the refactor's reach, such as shared infrastructure or many unrelated callers, makes preservation a review question of its own. The existing behavior it preserves is what a reviewer exercises.

## Contract first

The exception. Use only when an API, schema, document, or library contract needs independent agreement before its implementations or consumers proceed, and name that reason in the plan. Otherwise the contract lands inside the first slice that uses it.

## Boundary test

A boundary holds when a reviewer can exercise what the PR delivers and answer one review question. Splits by layer, by file count, or into scaffolding with no independent value fail that test. A dependent PR may rely on its parent, but it still needs a coherent review question.
