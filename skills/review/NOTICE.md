# Provenance

This skill is adapted from Alibaba's [Open Code Review](https://github.com/alibaba/open-code-review), reviewed at commit `cb6ea26`. It draws on the delegate skill's coverage checklist, the multi-round review loop and plan thresholds in `internal/agent`, and the prompts in `internal/config/template/prompts`.

Slop(e)style moves Open Code Review's deterministic engine into instructions for a host agent and its subagents. The file grouping thresholds, plan thresholds, round counts, and confirmed-finding cap come from upstream defaults. The review filter becomes an orchestrator fact-check with full repository access. It adds a `confirmed` and `unverified` split and adds authorization and data exposure to the protected subjects. Comment relocation becomes a search for quoted code. Slop(e)style's existing review framing, lenses, fix scope, and finding shape remain in the unified skill.

The upstream work is Copyright 2026 alibaba/open-code-review Contributors and licensed under the bundled Apache License 2.0 `LICENSE`. The skill text is a modified adaptation, not a verbatim copy.
