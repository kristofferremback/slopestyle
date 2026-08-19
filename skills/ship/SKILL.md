---
name: ship
description: Use when the user asks to commit, push, file, open, create, or update a pull request, create a stack, or ship a coherent unit for review.
---

# Ship

Turn one coherent review unit into owned commits and a reviewable PR or stack. Shipping stops before merge.

## Inspect first

1. Read repository guidance and determine the base branch, stack tooling, title conventions, and required checks.
2. Inspect status, diff, commits, and any existing PR for the branch.
3. Identify exactly which files and hunks belong to this work. Preserve every unrelated change.
4. Confirm the unit matches its intended review boundary. Do not sweep unfinished or unrelated work into it.
5. When behavior changed, load `test` and run its appropriate local checks. For prose or metadata-only work, run the narrow checks that can fail because of the change. Green claims require observed evidence.

## Commit owned work

Stage explicit owned paths or hunks. Never use broad staging to collect the working tree.

Write a concise subject that matches repository history and explains the outcome. Add only the actual model as a co-author trailer:

```text
Co-Authored-By: <actual model> <provider noreply email>
```

Read the model from the harness or runtime environment. Never guess. Do not add generated-with text or session links.

If a merge or rebase conflicts, follow [conflict resolution](references/conflict-resolution.md).

## Push and file

- Never open an issue, pull request, comment, or maintainer message in someone else's repository unless Kristoffer explicitly asked while working on that repository.
- Check whether the branch already has a PR before creating one.
- Preserve the stack and review shape chosen by `build`.
- Open a ready PR by default so checks and reviewers run. Use draft only when requested or when the review contract is genuinely incomplete.
- Read recent merged PRs and git history before choosing title and body conventions.
- Follow [PR writing](references/pr-writing.md).
- Push only owned commits. Never force-push unless the repository workflow requires it and the affected remote history is understood.

When invoked by `build`, return the PR identity immediately so `shepherd` can start in the background while the next slice continues.

## Finish

Report the commit, direct PR link, observed checks, and caveats. Do not merge. Merge and deployment belong to `deploy` after explicit approval.
