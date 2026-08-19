# PR slicing

A PR is a review unit. Give each one a focused review goal and a reason to land independently while the complete stack delivers the accepted outcome.

## Vertical slice

Use by default. Deliver one representative behavior end to end so a reviewer can verify a complete part of the outcome.

## Sample then build

Use for broad refactors or shared mechanisms. Introduce the new path through one representative real use. Review that mechanism deeply, then roll it out broadly in a follow-up reviewed for completeness.

## Contract first

Use when an API, schema, document, or library contract needs independent agreement before its implementations or consumers proceed.

## Reject weak boundaries

Do not split by arbitrary file count, backend versus frontend, scaffolding with no independent value, or steps that leave no verifiable state. A dependent PR may rely on its parent, but it still needs a coherent review question.
