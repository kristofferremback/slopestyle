# Local patches

## Upstream base

- Source: <https://github.com/cursor/plugins/tree/main/pstack/skills/unslop>
- Commit: `60c641e4fad674784b30abcf9f8915dea39df38d`
- Unmodified `SKILL.md` SHA-256: `181883e539caec8258ec9129e3ba5f133409144a2cbf2aa361158ab94cfc3441`
- Current fork `SKILL.md` SHA-256: `dc27aaa74a976fbce60f57c569579821e2ee466993eeeb5f8f394247883b07ad`

## Intentional changes

### Reject "earn its keep"

Added plain-speech pattern 32. Agents use "earn its keep", "earns its keep", and close variants so often that the phrase has become noise across reviews, tests, dependencies, and abstractions.

Replace it with the concrete requirement or observed result. If no concrete threshold exists, remove the claim.
