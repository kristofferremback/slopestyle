# Fix disposition

Before writing code for a finding, record its relationship to the accepted behavior, the responsible owner, and one of these decisions. Unverified claims need investigation before a fix can be selected; unresolved risks stay visible in the report.

- **Fix at the owner.** For an in-scope defect or maintainability problem, repair the responsible owner and reuse its protections. Preserve required behavior while improving structure or readability. Necessary complexity earns its place through the requirement it serves.
- **Remove or reroute.** If the finding targets machinery this change introduced unnecessarily or duplicates an existing owner, remove it or use that owner before hardening it. Preserve accepted behavior and existing guarantees unless their change was explicitly agreed.
- **Propose beyond scope.** Keep real risks outside the accepted outcome visible, with their impact and a proposed boundary. Bring changes to the agreed scope or architecture to Kris with the tradeoff while continuing unblocked in-scope work.

The decision is complete when the remedy satisfies the required behavior at its owner, or the report identifies the remaining uncertainty or scope decision. A true finding does not by itself justify its suggested implementation.
