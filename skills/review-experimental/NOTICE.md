# Provenance

This skill is adapted from Alibaba's [Open Code Review](https://github.com/alibaba/open-code-review), reviewed at commit `cb6ea26`. It draws on the delegate skill's coverage checklist, the multi-round review loop and plan thresholds in `internal/agent`, and the prompts in `internal/config/template/prompts`.

Slop(e)style moves Open Code Review's deterministic engine into instructions for a host agent and its subagents. The file grouping and plan thresholds come from upstream defaults. Slop(e)style departs from upstream's multi-round loop and confirmed-finding cap: it runs one round, has reviewers prove findings with runs, and caps style and architecture findings. The review filter becomes an orchestrator fact-check with full repository access and explicit `proved`, `traced`, `unverified`, and `disproven` outcomes. Evidence across execution paths can disprove claims, including safety claims; uncertainty stays visible. Fix disposition separately connects findings to accepted behavior and existing owners. Comment relocation becomes a search for quoted code. Slop(e)style's existing review framing, lenses, fix scope, and finding shape remain in the unified skill.

The upstream work is Copyright 2026 alibaba/open-code-review Contributors and licensed under the bundled Apache License 2.0 `LICENSE`. The skill text is a modified adaptation, not a verbatim copy.


## Local experiment modifications

Codex modified this snapshot in November 2026 for isolated review evaluations. The experiment removes finding quotas, retains evidence-qualified actionable feedback, and adds behavioral contract review, adversarial checks, platform references, mandatory-gate accounting, and bounded fresh-reviewer scheduling. The preceding Slop(e)style provenance describes its upstream adaptation, including the caps that these experimental instructions remove. No endorsement by the upstream authors is implied.

Local experiment v10: the existing final gap pass challenges consequential rejection and retention rationales with concrete counterexamples.

Local experiment v11: independent assignment queue and host-compatible completion scheduling; no separate close control is assumed.

Local experiment v12: compare ownership across all sibling coordinator branches and read supplied primary requirements directly.

Local experiment v13: dependency-cohesive group preparation and separate comparison of effect policy versus caller obligations.

Local experiment v14: structural comparisons survive final comments; mandatory gates cite authority and remain separate from exploratory verification.

Local experiment v15 draft: fresh final-report audit checks the delivered draft against saved assessments and supported dispositions.

Local experiment v16: compare ownership of a complete repeated domain predicate with ownership of its input representation.

Local experiment v17 draft: reconcile supported comments into one working report throughout the review, and reuse completed independent proof receipts during synthesis. Coverage, audits and finding thresholds remain.

V17 draft refinement: place input-contract comparison in the initial style workflow and separate composed-result membership, numerical meaning and presentation during behavior discovery.

Local experiment v18 draft: explicit full-report final-response delivery; preserve published state/receipt guarantees from evidence; distinguish local claim clarity from whole-document truth.

November 2026 calibration: challenge the whole design against original requirements before local review and fixes, select feedback by net benefit, and deliver concise actionable reports with supported omissions.
