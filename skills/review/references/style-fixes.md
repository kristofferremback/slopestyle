# Applying findings

Use for apply or offer-commit mode, or when the task otherwise authorizes fixes. Continue within that authorization; proposing the concrete design is not an extra approval gate. Reviewing style does not certify functional correctness, but changing code requires checking that behavior is preserved.

## Implement the ownership change

Before editing, state the intended boundaries, behavior and proof briefly. Record the pre-edit findings so later cleanup does not erase the original hard parts. Preserve the fixed base or other comparison constraints when the task supplies them.

Change complete responsibilities within the accepted scope, preserving ordering, transaction boundaries and retry guarantees. Read the caller and new owner together after extraction. Keep non-blocking follow-ups deferred unless separately authorized; follow the task's approval rules for material departures.

When a refactor-first proposal is accepted, keep the behavior-preserving refactor separately reviewable from the feature change. Verify existing behavior at that intermediate step before adding new behavior.

Name intentional behavior changes explicitly, including errors, timestamps, identity and concurrency semantics. “Refactor” is not proof of equivalence. Follow changed values through their consumers and distinguish source reasoning from executed evidence.

## Prove the result

Use the repository's test workflow and the available `test` skill to select focused checks. Apply the guide's test design rules: visible assumptions, isolated fixtures and assertions on outcomes. For a reachable regression, establish failure before the fix and success afterward where feasible. Exercise changed failure/retry boundaries at the real local interface when practical; record which external systems remain faked.

Run applicable formatting, lint, type and behavior checks. Report failures and evidence gaps honestly. Preserve valid earlier evidence, but identify the changed scope it does not cover. Revisit the [style pass](style-review.md)'s responsibility audit against the final implementation.

Use the available `review` workflow for a fresh review of the completed change. Keep its coverage and fact-checking in one place. Resolve confirmed findings, verify their fixes and re-review the affected delta. Honor explicit limits on delegation and report the resulting review coverage.

## Deliver within the request

In apply mode on Kris's PR, use the existing shipping workflow to commit and push verified, in-scope improvements to its branch. Recheck the remote head before pushing and account for concurrent work. Preserve unrelated edits and never overwrite another contributor's commits. Broader redesign or behavior changes still follow the task's scope rules.

### Optional commit for another author

Use this for a small, self-contained improvement that is cheaper to demonstrate than describe. A broader refactor can be offered as implementation work without undertaking it during the review.

1. Start an isolated worktree and a new topic branch at the exact reviewed head. Leave the author's local and remote branch untouched.
2. Implement one coherent improvement and run the same relevant checks as a direct fix. Inspect the commit for unrelated files, hidden dependencies and behavior changes.
3. Verify the commit applies cleanly to the reviewed head in a disposable checkout. If the PR head has moved, check against the new head and state which revision the patch supports.
4. Push only the new topic branch to a repository Kris owns or maintains where publication is authorized. For another repository, obtain the required publishing authorization or keep the patch local. Never update the author's PR branch without their explicit consent. Do not create a new PR merely to offer a commit.
5. Supply the commit link, source head, benefit, checks and a copyable command using the actual remote URL, topic branch and commit SHA:

   ```sh
   git fetch <remote-url> <topic-branch>
   git cherry-pick <commit-sha>
   ```

Present adoption as optional. Publishing the review comment itself follows the task's communication authorization. A local-only commit is not a usable remote cherry-pick offer.

For either mode, include concise before/after examples, the behavior delta, proof and important limits. Keep original experiment submissions distinguishable from post-review fixes when comparing approaches.

Finish when the requested deliverable is complete, the ownership audit accounts for every recorded hotspot, and required verification/review is complete or its blocker is explicit. Creating a draft alone does not establish completion; merging, deploying and expanding the assignment remain governed by the user's instructions.
