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

Follow the repository's PR template when it has one. Otherwise, open with what the change does in one to three plain sentences, so a reader who stops there knows the outcome. Name a one-way or deploy-sensitive change there too. Never lead with the problem, an implementation inventory, or a long plan.

Then use these sections, keeping only the ones the change earns:

- **`Changes`:** what the change adds or alters, named the way people will use it: metrics, endpoints, flags, settings, migrations, screens. Use a table when there are several of one kind. Name the deliverable before the mechanism, and explain the mechanism in at most two sentences. Something a dependency brings along gets one line.
- **`Review notes`:** one to four bullets, each led by a bold sentence that states what a reviewer must get right, such as "**The migration is one-way.**", rather than a label such as "**Rollback:**". Include deploy order, flags, anything unproven, and what the change deliberately doesn't do.
- **`Background`:** why, when the summary leaves it unclear. A bug fix states the root cause and why it surfaced now.

Keep the prose above the proof to one screen, about 250 words not counting tables, and say each thing once. A horizontal rule closes it. Where the host renders `<details>`, collapse proof, files and size under summary lines that state the headline result:

- **Proof:** at most five observed results: tests, screenshots, traces, runs. Leave out routine checks and process narration, such as who reviewed or how many rounds it took. End with what was not verified.
- **Files:** one row per changed file or directory, saying what changed in it.

Link tickets, stacked dependencies, artifacts, and relevant product context directly. Make every claim true at the pushed head.
