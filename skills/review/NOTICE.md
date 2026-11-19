# Provenance

This skill is adapted from Alibaba's [Open Code Review](https://github.com/alibaba/open-code-review), reviewed at commit `cb6ea26`. It draws on the delegate skill's coverage checklist, the multi-round review loop and plan thresholds in `internal/agent`, and the prompts in `internal/config/template/prompts`.

Slop(e)style moves Open Code Review's review loop into instructions for a host agent and its subagents. It runs one round of fresh reviewers per pass, has reviewers prove findings with runs, separates proved from traced findings, and caps style findings. The references keep the fact-check, fix-disposition and coding-style workflows that `shepherd` and `coding-style-review` use.

The upstream work is Copyright 2026 alibaba/open-code-review Contributors and licensed under the bundled Apache License 2.0 `LICENSE`. The skill text is a modified adaptation, not a verbatim copy.
