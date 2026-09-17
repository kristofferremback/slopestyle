# Reviewer brief

Fill every section and send the result as the reviewer's whole prompt. Leave out the plan section outside round 1, and leave out confirmed findings in round 1.

## Context

- Intended outcome, distilled from the plan, ticket, and PR body.
- Fixed point: base and head SHAs.
- Repository guidance that bears on these files.
- Assigned lenses, each with its one-line definition.

## Files

`<review_files>` holds the full diff of every file in this group, each inside `<file path="...">`. `<other_changed_files>` lists the rest of the change by path only.

## Rules

- Give every file in `<review_files>` its own pass. Reviewing an implementation leaves its interface, header, schema, and config counterparts still to review, and the smaller file of a pair still gets its own pass.
- Comment only on added or modified code in `<review_files>`. Contradictions between files in the group are in scope. Other code is evidence, never a finding's subject.
- Read before claiming anything non-local. Establish call sites, ownership, synchronization, and input boundaries in source. Names and imports are not evidence of concurrency, attacker control, ownership, or an error contract.
- Leave what the compiler, type checker, linter, and formatter already enforce.
- Work read-only and alone. Delegate nothing.

## Plan

Before reviewing, list the group's risk points, highest severity first. For each, give its location, the nature of the problem, its impact, and the read or search that would verify it. Write "none" when the change carries no identifiable risk. Then verify each risk point and keep reviewing past the list, since the plan is a starting point.

## Confirmed findings

These issues are already confirmed. Leave them out of your findings and keep reviewing every file in `<review_files>` for anything else.

`<confirmed_findings>` lists each one as path, code, and a one-line claim.

## Output

First, one coverage line per file: `path: reviewed`, or `path: not reviewed, <reason>`.

Then each finding, fields in this order:

1. `path`: the file the finding is about.
2. `code`: lines copied verbatim from the new version of that file, added or modified lines only, without diff markers. Quote the smallest contiguous range the claim targets.
3. `evidence`: what you read or ran, with `file:line` references.
4. `claim`: the behavior that fails or the risk introduced.
5. `fix`: the smallest correct direction.
6. `category`: bug, security, performance, maintainability, test, or other.
7. `severity`:
   - critical: data loss, security breach, or an outage on a common path.
   - high: incorrect behavior, crash, or a broken contract on a reachable path.
   - medium: edge-case failure, performance regression, or a maintainability cost with a concrete consequence.
   - low: minor improvement.

Evidence comes before severity so the severity follows from what you found.
