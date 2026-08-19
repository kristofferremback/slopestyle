# Decision trails

Use a trail for long, ambitious, or unattended work when Kris must reconstruct important choices afterward.

Keep it append-only and outside the repository alongside the plan. Record decisions, pivots, blockers, and verified checkpoints, not routine actions.

Each entry contains:

- **Phase:** where the decision occurred
- **Decision:** what changed or was chosen
- **Why:** the concrete reason
- **Evidence:** a direct link, commit, path, test, trace, or artifact
- **Result:** verified outcome, open question, revert, or blocker

`handover` consumes the trail. `review` owns independent scrutiny. Commit a trail only when it is itself needed for review and the agreed plan says so.
