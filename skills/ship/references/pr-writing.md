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

- **`Changes`:** the one or two things a reviewer must see to judge the change, in whatever form shows them best. Showing usually beats describing. Forms that often work are screenshots or a recording when a person can see the change, the rule or limit as code, a few example inputs and their outputs, the diff itself when it's small, the signature or payload of a new boundary, a before and after of something removed or renamed, and a table for several items of one kind. A short paragraph is fine when it says it best.
- **`Review notes`:** one to four bullets, each led by a bold sentence that states what a reviewer must get right, such as "**The migration is one-way.**", rather than a label such as "**Rollback:**". Include deadlines, flags, contract changes, anything unproven, and what the change deliberately doesn't do. Deploy steps go in a numbered list.
- **`Background`:** why, when the summary leaves it unclear. A bug fix states the root cause and why it surfaced now.

Keep the prose above the proof to one screen, about 250 words not counting screenshots, code or tables, and say each thing once. A horizontal rule closes it. Where the host renders `<details>`, collapse proof, files and size under summary lines that state the headline result:

- **Proof:** at most five observed results: tests, screenshots, traces, runs. Leave out routine checks and process narration, such as who reviewed or how many rounds it took. End with what was not verified.
- **Files:** one row per changed file or directory, saying what changed in it.

Link tickets, stacked dependencies, artifacts, and relevant product context directly. Make every claim true at the pushed head.
