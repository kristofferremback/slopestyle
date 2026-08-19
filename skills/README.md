# Skills

Slop(e)style keeps one canonical directory per adapted or original skill. `manifest.json` records harness targets, requirements, upstream sources, and whether each skill is original, adapted, or a remote pointer. Adapted skills include their upstream license and a provenance notice.

Vendor skills stay external when no adaptation is needed:

- `unslop` installs from pstack through the `skills` CLI.
- Railway's `use-railway` remains vendor-managed.

Every runtime description is a short invocation pointer. Workflow details belong in `SKILL.md` bodies and progressively disclosed references.
