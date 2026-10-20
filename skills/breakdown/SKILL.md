---
name: breakdown
description: Use when Kris asks to break down a project or large change into tickets, or to write or rewrite a ticket.
---

# Breakdown

Turn agreed work into slices that each prove something on their own, and tickets that say exactly that.

1. **Start from agreed scope.** The outcome, boundary, done evidence, tracker, and parent come from Kris's request or `scope`. Use `scope` when any of them is unclear. Without a tracker, the tickets are returned in the reply.
2. **Find the seams.** Trace the current behavior and owners the slices will cut through, so they follow real seams.
3. **Slice.** Cut by [slicing](references/slicing.md). Every slice passes its boundary test.
4. **Separate decisions from build work.** A question that needs research or a `prototype` before anyone can build becomes a decision ticket. Questions Kris can answer now go in the proposal. Work that cannot yet be stated precisely stays as fog in the parent.
5. **Propose.** Send Kris a numbered list, each line naming the title, what the slice proves, and what blocks it. Recommend granularity and ordering, and wait for agreement.
6. **Write and publish.** Write the parent first, then each ticket, with [ticket writing](references/ticket.md). Publish through `use-linear` or `use-github`: blockers first, native blocking relations and sub-issues where the tracker has them.

A single requested ticket that passes the boundary test goes straight to writing. When it fails, propose the split. Rewriting a ticket starts from its current text and state; a split original becomes the parent or closes linked to its replacements, as proposed.

The breakdown is done when every agreed slice is a ticket that passes the rules in ticket writing, published or returned. Implementation starts only through `build` when Kris asks for it.
