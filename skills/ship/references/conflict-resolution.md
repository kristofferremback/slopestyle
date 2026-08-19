# Conflict resolution

1. Inspect the merge or rebase state, conflicting files, history, and unrelated working-tree changes.
2. Trace each side to its commit, PR, ticket, and accepted outcome. Understand both intents before editing.
3. Resolve hunk by hunk. Preserve both intents where compatible. Never choose an entire side blindly or invent new behavior.
4. When intents conflict at the product contract, architecture, or risk level, ask Kris in ordinary text and continue unrelated resolutions.
5. Stage only resolved owned paths. Never stage everything or discard unrelated work.
6. Run focused checks and inspect the resolved diff.
7. Continue the operation through every commit.

Abort only when the operation itself is wrong, such as the wrong base or target. Difficulty is not a reason to abort. Continuing a local merge or rebase does not authorize merging a PR or deploying.
