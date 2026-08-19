# PR writing

Read [`attribution.md`](attribution.md) and apply `unslop`.

## Title

Match recent repository convention. Prefer a concise human-readable outcome that explains why the change matters, not a list of touched internals.

Bad:

> Fix server parser and update preflight

Good:

> Prevent version drift from blocking remote startup

Adapt examples to the repository. Never reuse wording that does not describe the actual change.

## Body

Lead with the user's problem in plain language. Explain the solution second. Do not lead with an implementation inventory or paste a long plan.

Use only sections the change earns:

- **Problem:** what failed or was missing and why it mattered
- **Solution:** the resulting behavior and important design choice
- **Proof:** observed tests, screenshots, traces, or other evidence
- **Caveats:** real limits, follow-up boundaries, or unverified claims

Link tickets, stacked dependencies, artifacts, and relevant product context directly. Make every claim true at the pushed head.
