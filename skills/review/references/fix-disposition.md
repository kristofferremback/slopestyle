# Fix disposition

The coordinating agent protects the agreed scope and reviewability of the complete change. Evaluate feedback against the intended outcome, existing guarantees, and the combined cost of proposed fixes. Valid observations do not automatically become requirements for this change. Keep optional hardening and adjacent improvements as separate proposals. If necessary corrections materially expand the change, bring that tradeoff to Kris before expanding it.

Before writing code for a finding, record its relationship to the accepted behavior, the responsible owner, and one of these decisions. Unverified claims need investigation before a fix can be selected; unresolved risks stay visible in the report.

- **Fix at the owner.** For an in-scope defect or maintainability problem, repair the responsible owner and reuse its protections. Preserve required behavior while improving structure or readability. Necessary complexity earns its place through the requirement it serves.
- **Remove or reroute.** If the finding targets machinery this change introduced unnecessarily or duplicates an existing owner, remove it or use that owner before hardening it. Preserve accepted behavior and existing guarantees unless their change was explicitly agreed.
- **Propose beyond scope.** Report real risks outside the accepted outcome with their impact, a proposed boundary, and the decision needed. Continue unblocked in-scope work.

The decision is complete when the remedy satisfies the required behavior at its owner, or the report identifies the remaining uncertainty or scope decision.
