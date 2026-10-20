# Ticket writing

A ticket is a contract a capable engineer, human or agent, could pick up cold. It states the outcome and how to prove it. The implementer finds the code and chooses the implementation when the work starts, holding the full picture.

## Build ticket

```markdown
<Title: the outcome in product vocabulary, e.g. "Members can rename a workspace">

## Outcome
<Before and after, as a user or operator sees it. One to three sentences.>

## Why
<One or two sentences, or a link to the parent or scope it serves.>

## Done when
- [ ] <On <surface>, <action> shows <result>.>

## Out of scope
- <Adjacent work an implementer may reach for, linked to its ticket when tracked.>

## Decisions
- <Agreed constraints the implementer must honor: chosen approach, contract, interface or type by name, edge behavior. Omit the section when none exist.>
```

A bug ticket's before is the observed behavior with reproduction steps; its after is the expected behavior. Its done when includes a check that fails before the fix.

## Decision ticket

```markdown
<Title: the question, e.g. "Which store owns workspace membership?">

## Question
<The decision and why it is open.>

## Answered by
<Research or a prototype, and the evidence it needs.>

## Unblocks
- <Each ticket waiting on the answer.>

## Done when
- [ ] The decision is recorded on this ticket and the unblocked tickets reflect it.
```

## Parent

The parent (project, epic, or issue) holds the destination, the agreed scope, constraints shared by its tickets, out-of-scope work, and fog: work in scope that cannot yet be stated precisely. Its done when proves the whole outcome. Tickets link to it instead of restating it.

## Rules

- Every sentence changes what the implementer does or how they prove it. Link context.
- Name behaviors, contracts, interfaces, and domain concepts. Where and how to build stays with the implementer unless it is an agreed decision. Evidence that points at code, such as a stack trace or a bug narrowed to a function, belongs in the ticket as evidence.
- Each criterion is checkable on its own by someone who did not write the code. Name what an observer sees, the way a reviewer would verify it, in the ticket itself.
- Metadata lives in the tracker's fields: parent, blocking relations, labels, estimate.
- The body is the current contract. Progress, rulings, and delivery evidence go in comments and PRs; when scope changes, rewrite the body.
- A ticket fits on a phone screen. One that needs more is two slices or is restating its parent.
