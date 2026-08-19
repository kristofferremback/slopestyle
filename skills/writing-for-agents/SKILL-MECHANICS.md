# Skill mechanics

This is the Slop(e)style skill-specific companion to [`writing-for-agents`](SKILL.md). Matt Pocock's main writing guidance remains unchanged. Slop(e)style replaces only its invocation model so one canonical skill tree behaves consistently across Pi and Claude Code.

## Invocation is a mode

Most skills support both modes:

- **Implicit:** the agent loads the skill because the current task matches its frontmatter description or another skill requires it.
- **Explicit:** the user names the skill or invokes its skill command.

These are ways to reach a skill, not permanent skill categories. A directly invoked skill can still compose another skill, and a skill the agent usually discovers can still be named by the user.

External impact is a separate concern. A skill may load while planning or inspecting, but merge, deployment, human outreach, destructive operations, and other gated actions still require the approval defined by global and repository guidance.

Use `disable-model-invocation: true` only when automatic discovery itself would be harmful. Do not use it merely because a skill is commonly named by the user.

## Descriptions are trigger pointers

The description is always-loaded routing text. Keep it short and trigger-first:

1. Start with `Use when` or an equally direct trigger.
2. Name each distinct request shape that should load the skill.
3. Include the minimum identity needed to disambiguate it.
4. Leave workflow, rationale, output format, and examples in the body.

Portfolio prose written for humans can be richer. Do not copy it into runtime frontmatter.

## Composition

Compose around outcomes rather than building a router for every command. `build` may load `frontend`, `test`, `ship`, `shepherd`, and `review` as their triggers arise. Each composed skill remains directly invokable on its own.

Keep shared reference in one skill or disclosed reference file. Point to it from callers. Never copy the same contract into several skill bodies.

## Cross-harness content

- Use Agent Skills frontmatter accepted by both Pi and Claude Code.
- Use paths relative to the skill directory for bundled references and scripts.
- Keep harness commands behind a disclosed reference when mechanics differ.
- Describe required tools or credentials in the manifest and fail visibly when they are unavailable.
- Do not hardcode model names. Capability routing belongs in runtime configuration.
