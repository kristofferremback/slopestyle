---
name: handover
description: Use when the user asks for a handover, another agent or session must continue, context is ending, or work needs an exact resumable state.
---

# Handover

Give the next agent enough verified state to continue without repeating investigation. Keep raw transcript bulk out.

Write the handover outside the repository unless the user explicitly requests a repository artifact.

## Include

- **Outcome:** accepted goal and current completion state
- **Plan:** agreed high-level plan, active blueprint, and current phase
- **Decisions:** contract, architecture, scope boundaries, and superseded choices
- **Invariants:** global, repository, and skill rules that materially affect the next action
- **Evidence:** observed tests, checks, artifacts, links, and what remains unverified
- **Implementation:** files and behavior changed, not a line-by-line inventory
- **Git:** repository, worktree, branch, base, commits, dirty owned paths, unrelated dirty state, PRs, and stack relationships
- **Review:** checks, comments, accepted findings, re-review, and ready status
- **Exceptions:** deviations, failed approaches, blockers, risks, and caveats
- **Next action:** one exact, immediately executable step

Consume any `build` decision trail and reconcile it with live git, PR, and check state. History is not current truth.

## Quality bar

Use direct links over bare references. Mark observation, inference, and unknowns. Preserve secrets and private context. A handover is complete when a fresh agent can state the outcome, locate the work, avoid known dead ends, and execute the next action without asking what happened.
