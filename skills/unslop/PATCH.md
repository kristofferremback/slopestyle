# Local patches

## Upstream base

- Source: <https://github.com/cursor/plugins/tree/main/pstack/skills/unslop>
- Commit: `df581122cde17e6e27686b5a448bde23e4ad4318`
- Unmodified `SKILL.md` SHA-256: `195411d320b5b328f9f642baf59757ed19aaf0931c0838740e0aca273d538dc1`
- Current fork `SKILL.md` SHA-256: `e7a2450f50c369680cbebc99cd22e7b87aedc6fcc48403583d2b4cc2372a32cd`

## Intentional changes

### Opt-in use

The skill description triggers when asked to remove AI tells from writing. Routine writing no longer loads the skill by default. Upstream's `disable-model-invocation: true` is dropped so an agent can still load the skill when asked in plain words.

### Reject "earn its keep"

Added plain-speech pattern 34. Upstream claimed 32 and 33, and rule numbers are stable ids. Agents use "earn its keep", "earns its keep", and close variants so often that the phrase has become noise across reviews, tests, dependencies, and abstractions.

Replace it with the concrete requirement or observed result. If no concrete threshold exists, remove the claim.
