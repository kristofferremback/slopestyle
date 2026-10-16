# PR writing

Read [`attribution.md`](attribution.md).

## Title

Match recent repository convention. Prefer a concise human-readable outcome that explains why the change matters, not a list of touched internals.

Bad:

> Fix server parser and update preflight

Good:

> Prevent version drift from blocking remote startup

Adapt examples to the repository. Never reuse wording that does not describe the actual change.

## Body

Follow the repository's PR template when it has one. Otherwise, open with what the change does in one to three plain sentences, so a reader who stops there knows the outcome. Say what a reviewer must get right before explaining how it works, and explain why last. Never lead with the problem, an implementation inventory, or a long plan.

Use only the parts the change earns, in this order. Don't title them with headings: the order carries the structure, and a horizontal rule sets the why apart.

- **Summary** (no heading): the resulting behavior
- **Focal point:** the decision, invariant, risk, or deploy constraint a reviewer must get right, including anything unproven
- **How it works:** the mechanism, not a file list
- **Why:** what was missing or failed, when the summary leaves it unclear. A bug fix states the root cause and why it surfaced now.
- **Proof:** observed tests, screenshots, traces, or other evidence. Where the host renders `<details>`, collapse long proof under a summary line that states the headline result and the biggest gap.
- **Caveats:** real limits, follow-up boundaries, or unverified claims

Link tickets, stacked dependencies, artifacts, and relevant product context directly. Make every claim true at the pushed head.
