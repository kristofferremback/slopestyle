# Fix disposition

The coordinating agent protects the agreed scope and reviewability of the complete change. Evaluate feedback against the intended outcome, existing guarantees, and the combined cost of proposed fixes. Valid observations do not automatically become requirements for this change. Keep optional hardening and adjacent improvements as separate proposals. If necessary corrections materially expand the change, bring that tradeoff to Kris before expanding it.

Before writing code for a finding, use the [whole-change design comparison](lenses.md#challenge-the-design) to decide whether its mechanism should survive. A reproduced defect in newly introduced machinery proves a problem with that machinery, not that the machinery is needed. Compare removing or simplifying it with repairing it, while preserving accepted behavior. Repeated defects or growing exception lists call for revisiting that choice before another patch.

Record the finding's relationship to accepted behavior, its owner, the remedy's benefit and combined cost, and one of the decisions below. Correct in-scope defects and traced risk-class findings Kris accepts; select optional improvements only when their benefit earns their reach and verification work. A complete source-backed violation may justify an in-scope fix with missing execution stated; verify it before claiming success. Hypotheses still need their contract and causal chain established. "No change" with its reason is a complete decision.

- **Fix at the owner.** For an in-scope defect or maintainability problem, repair the responsible owner and reuse its protections. Preserve required behavior while improving structure or readability. Necessary complexity earns its place through the requirement it serves.
- **Remove or reroute.** If the finding targets machinery this change introduced unnecessarily or duplicates an existing owner, remove it or use that owner before hardening it. Preserve accepted behavior and existing guarantees unless their change was explicitly agreed.
- **Propose beyond scope.** Report real risks outside the accepted outcome with their impact, a proposed boundary, and the decision needed. Continue unblocked in-scope work.

The decision is complete when the remedy satisfies the required behavior at its owner, or the report identifies the remaining uncertainty or scope decision.
