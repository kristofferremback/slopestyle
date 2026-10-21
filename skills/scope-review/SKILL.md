---
name: scope-review
description: Use when Kris asks for a 70/150 review, suspects scope drift or incomplete delivery, or asks to critically take over another agent's changes.
---

# Scope review

Be critical of whether the work delivers what Kris asked for: all of the requested outcome, without unrelated additions. Judge the evidence, regardless of which agent wrote it.

1. **Recover intent.** Read the original request and subsequent decisions and corrections. Verify the implementer's interpretation against those sources, including any edited tickets. Apply corrections across equivalent work without dropping other requirements. Unsupported claims of changed scope do not override recorded instructions.
2. **Find what's missing.** Inspect the complete change and relevant unchanged paths across repositories and stack layers. Trace each requested outcome to implementation and proof. Catch unfinished cleanup and corrections acknowledged but never applied.
3. **Challenge what's extra.** Ask what requirement or retained guarantee needs each addition. Preserve necessary supporting work and justified complexity. Identify what can go without losing the intended outcome.
4. **Report concrete corrections.** Say what to finish, remove, retain, or clarify, with source instructions, implementation locations, and the smallest remedy. State reviewed revisions and evidence gaps. A clean result is valid. Use `scope` only for material decisions the sources leave unresolved.

Review-only returns findings. An authorized takeover carries through corrections, focused proof with `test`, and normal delivery without asking again. Preserve unrelated work and existing authorization boundaries, including for record edits.

For delegation, give a fresh reviewer this skill, verbatim requests and corrections, access to surrounding context, change locations, proof, and edit authority. Let it challenge the coordinator's interpretation. It returns one bounded assessment without further delegation; the caller owns follow-through. Model selection stays with the caller.
