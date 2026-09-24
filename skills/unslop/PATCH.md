# Local patches

## Upstream base

- Source: <https://github.com/cursor/plugins/tree/main/pstack/skills/unslop>
- Commit: `60c641e4fad674784b30abcf9f8915dea39df38d`
- Unmodified `SKILL.md` SHA-256: `181883e539caec8258ec9129e3ba5f133409144a2cbf2aa361158ab94cfc3441`
- Current fork `SKILL.md` SHA-256: `c75220420b1e001089b27d4f19203d50b591a016d2f961600eb44f5f42816aa5`

## Intentional changes

### Opt-in use

The skill description triggers when asked to remove AI tells from writing. Routine writing no longer loads the skill by default.

### Reject "earn its keep"

Added plain-speech pattern 32. Agents use "earn its keep", "earns its keep", and close variants so often that the phrase has become noise across reviews, tests, dependencies, and abstractions.

Replace it with the concrete requirement or observed result. If no concrete threshold exists, remove the claim.
