# T3 Code native PR watching

Use `watch_pull_request` for monitoring and `unwatch_pull_request` for cleanup. Discover these tools in the current tool catalog and follow their live descriptions and harness instructions.

- Finish planned branch updates and pushes, then handle existing comments and unresolved reviews before registering a watch. Only later comments and reviews trigger wakeups.
- Call `watch_pull_request` with the PR URL, then end the turn. It links the PR if needed and wakes the owning thread on failed checks, passed required checks, new comments or reviews, or conflicts. For a stack, register all needed watches before ending the turn.
- A watch persists across wakeups and pushes. On a wake, inspect the current head and relevant evidence, complete the fix loop, and end the turn while waiting for further events. Register again only if monitoring was stopped. Keep waiting in T3 rather than adding a polling script or agent loop.
- A notification is a reason to assess readiness against the skill's ready-state criteria. When ready, cancelled, or told to stop, call `unwatch_pull_request` before handing back. The PR stays linked.
- Delegated children return their PR URL, head SHA, and check/review state to the owning thread. The owning thread registers the watch and handles wakeups.

`link_pull_request` and `link_pull_requests` associate PRs with the thread without enabling monitoring. Follow the harness's linking requirements when creating, taking over, or pushing PRs; use the plural tool for several PRs.
