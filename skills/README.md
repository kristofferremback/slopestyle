# Skills

Slop(e)style keeps one canonical directory per original, adapted, synchronized, or forked skill. `manifest.json` records harness targets, requirements, upstream sources, and provenance.

Adapted skills bundle their upstream license and provenance notice. A locally patched fork also includes `PATCH.md`, a pinned upstream commit, and the hash of its unmodified upstream base. Use `sync-fork` to bring upstream changes into a fork without losing documented local intent.

Vendor skills stay external when no adaptation is needed. Railway's `use-railway` remains vendor-managed. Seer remains a pointer to its hosted source.

Every runtime description is a short invocation pointer. Workflow details belong in `SKILL.md` bodies and progressively disclosed references.
