---
name: sync-fork
description: Use when updating a locally patched skill from upstream, checking a fork for upstream changes, or reconciling a fork without losing documented local patches.
---

# Sync a skill fork

Update one locally managed skill fork while preserving every intentional patch. Upstream is an input, not an authorization target.

## Establish the fork contract

1. Read the fork's `PATCH.md`, `NOTICE.md`, manifest entry, and bundled license before fetching anything.
2. Identify the pinned upstream source, base commit, and unmodified file hash.
3. Treat each patch in `PATCH.md` as required behavior. If its intent is unclear or no longer compatible with upstream, stop for a developer decision.
4. Work in an isolated temporary checkout. Never alter another local repository or reuse its dirty state.

A managed fork contains `SKILL.md`, `LICENSE`, `NOTICE.md`, and `PATCH.md`. The manifest marks it `forked` and pins a full `upstreamCommit`.

## Compare three versions

Reconstruct:

- the pinned upstream base,
- current upstream,
- the local fork.

Verify the base file against the hash recorded in `PATCH.md` before using it. Separate upstream changes from local patches with a three-way diff. Do not infer local intent from the final file when `PATCH.md` states it directly.

## Reconcile

1. Start from current upstream.
2. Reapply each documented local patch deliberately.
3. Resolve semantic overlap from the skill's intended behavior, not by choosing one side of a textual conflict.
4. Preserve upstream licensing and attribution.
5. Update `NOTICE.md`, `PATCH.md`, the unmodified upstream hash, the current fork hash, and the manifest's `upstreamCommit` to the new base.
6. Document new or changed local intent in `PATCH.md`. Remove a patch only with explicit developer approval.

Keep the fork small. Do not copy unrelated upstream files or add compatibility machinery for changes the fork does not use.

## Prove the result

- Diff the new fork against the newly pinned upstream base. Every remaining delta must map to `PATCH.md`.
- Run the repository's source checks and any behavior checks affected by the skill.
- Report the old and new base commits, preserved patches, conflicts resolved, exact checks, and anything still unverified.

Never open an upstream issue, pull request, comment, or message a maintainer unless Kristoffer explicitly asks while you are working on that upstream repository. Discovering a useful upstream change does not grant permission to publish it.
