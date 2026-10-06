# T3 Code API and storage

Verified against the installed T3 Code `0.0.46-nightly.20261005.2676` source and its local database. These are internal contracts that can change between nightly builds. On a schema error, inspect `sqlite_master` and `PRAGMA table_info(...)` through a read-only connection, then compare the installed source before interpreting the records. Do not silently switch profiles or treat unavailable data as an empty result.

## Database and current context

T3's base directory defaults to `~/.t3`. Runtime data normally lives under `userdata`; development servers can use `dev`. An explicit base directory and `T3CODE_HOME` affect this choice. Pass the actual database path with `--db` for a development profile. Path derivation lives in [config.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/config.ts).

Open the database with SQLite URI `mode=ro`, enable `PRAGMA query_only=ON`, and read each export in one transaction. Keep WAL visibility. `immutable=1` or copying only the database file can miss recent data in its `-wal` sidecar. Do not run migrations, checkpointing, or cleanup against the live database.

Current builds write `statev2.sqlite`. It holds the `orchestration_v2_*` tables plus copies of the legacy tables, frozen when the data was imported. The older `state.sqlite` is frozen at the same point. The reader picks one schema per database: orchestration-v2 whenever `orchestration_v2_projection_threads` exists, otherwise legacy. It never mixes the two, and reports its choice in `source.schema`.

| Records | Orchestration-v2 table | Legacy table | Meaning |
| --- | --- | --- | --- |
| Thread | `orchestration_v2_projection_threads` | `projection_threads` | Title, lifecycle, branch/worktree, model. V2 keeps linked PRs, lineage, and forks in `payload`. |
| Project | `projection_projects` | `projection_projects` | Title and workspace root. V2 still uses the legacy table. |
| Conversation | `orchestration_v2_projection_messages` | `projection_thread_messages` | Message text, roles, timestamps, attachment metadata, streaming state. The v2 text and attachments live in `payload`, and the reader lifts them to the legacy shape. |
| Activities | `orchestration_v2_projection_turn_items` | `projection_thread_activities` | Tool calls/results, reasoning, file changes, subagents, checkpoints, compaction |
| Plans | `orchestration_v2_projection_plans` | `projection_thread_proposed_plans` | V2 plan steps and explanation, or legacy plan text |
| Turns | `orchestration_v2_projection_runs` | `projection_turns` | Run or turn lifecycle, provider thread linkage, checkpoint refs |
| Subagents | `orchestration_v2_projection_subagents` | none | Delegated work, including the child T3 thread ID |
| Linked PRs | thread `payload` | `projection_thread_pull_requests` | Explicit PR associations and recorded host snapshots |
| Session and resume | `orchestration_v2_projection_provider_sessions`, `orchestration_v2_projection_provider_threads` | `projection_thread_sessions`, `provider_session_runtime` | Provider status, model, and native thread identifiers |
| Checkpoint diffs | turn items of type `checkpoint` | `checkpoint_diff_blobs` | Checkpoint records or cached diffs |
| Approval state | `orchestration_v2_projection_runtime_requests` | `projection_pending_approvals` | Recorded requests and decisions, not fresh authorization |
| Audit history | `orchestration_v2_events` | `orchestration_events` | Append-only thread events, including superseded content |

In v2, `inspect` returns `session` as the thread's provider sessions and `provider_runtime` as its provider threads, both lists. V2 messages sort by `created_at, message_id`, and turn items sort by `ordinal, turn_item_id`. These orders follow [ProjectionStore.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/ProjectionStore.ts). Legacy messages sort by `created_at, message_id`. Legacy activities sort by `sequence, created_at, activity_id`, with null sequences first. Keep these collections separate. A merged timestamp timeline is an interpretation of interleaving, not a guaranteed reconstruction of the UI. See [ProjectionThreadMessages.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/persistence/Layers/ProjectionThreadMessages.ts) and [ProjectionThreadActivities.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/persistence/Layers/ProjectionThreadActivities.ts).

Rewinding rebuilds projections and can remove messages, activities, plans, and turns. The event stream still contains older data. Reading every `thread.message-sent` event as a separate message would duplicate streaming updates and revive reverted content. See [ProjectionPipeline.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/Layers/ProjectionPipeline.ts).

The reader excludes authentication tables, settings, secrets, and `runtime_payload_json`. Native thread IDs and resume cursors are provider-specific metadata. They are not credentials or permission to resume a session.

In v2, each provider thread's `payload.nativeThreadRef.nativeId` is the native conversation ID. For Claude Agent, search for `NATIVE_ID.jsonl` under `~/.claude/projects/`. For Codex, search the filenames under `~/.codex/sessions/` for that ID. Two verified legacy lookups are:

- Codex uses `resume_cursor_json.threadId`. Search the filenames under `~/.codex/sessions/` for that provider ID.
- Claude Agent uses `resume_cursor_json.resume`. Search for `PROVIDER_SESSION_ID.jsonl` under `~/.claude/projects/`. Its `threadId` can still be the T3 ID, and `resumeSessionAt` identifies a resume boundary inside the provider session.

Use `rg --files --hidden` with an ID-specific glob before opening a transcript. Other providers and custom provider homes differ. Keep the search scoped to the requested thread. These mappings come from [CodexSessionRuntime.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexSessionRuntime.ts) and [ClaudeAdapter.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeAdapter.ts).

## Files beside the database

Attachment metadata is stored with messages. Files live under the chosen state directory's `attachments/`. Image filenames use the attachment ID plus an extension derived from MIME type/name. File attachments use the ID plus a sanitized filename extension. Use metadata and the actual directory entries to locate an attachment, validate the path stays inside `attachments/`, and report missing files. Do not guess a path from the ID alone. Rewind/deletion cleanup may remove files. See [attachmentStore.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/attachmentStore.ts).

Provider logs live under `logs/provider/events.THREAD_ID.log`, with numbered rotations such as `.1`. Lines have an observed timestamp and `NTIVE`, `CANON`, or `ORCH` prefix before their JSON. They are not plain JSONL. Inventory rotations before reading, then filter for the requested turn, tool, or event. Retention, rotation, and omitted transient events make these diagnostic records incomplete. Tool payloads may contain private data. See [EventNdjsonLogger.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/EventNdjsonLogger.ts).

The state directory's `environment-id` plus the T3 thread ID identify the thread across environments. The browser route is `/threads/ENVIRONMENT_ID/THREAD_ID` on the correct T3 server origin. Do not invent the origin or confuse it with a provider session ID. The route is defined in [agentAwareness.ts](https://github.com/pingdotgg/t3code/blob/main/packages/shared/src/agentAwareness.ts).

## API and MCP findings

The inspected MCP server exposes preview, device, and current-thread PR tools. It exposes neither a message-reading tool nor resources/resource templates. `T3_MCP_BEARER_TOKEN` belongs to a separate in-memory, thread-bound MCP registry and is not an HTTP environment API credential. Recheck connected capabilities on newer builds before assuming this still holds. See [McpHttpServer.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/McpHttpServer.ts) and [McpSessionRegistry.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/McpSessionRegistry.ts).

The installed build exposes authenticated `GET /api/orchestration/threads/:threadId`. It accepts `turnLimit` and `beforeCursor`; omitting both returns full current messages. It excludes archived/deleted threads and hydrates the newest 500 activities plus pinned unresolved requests. Subsequent projection removes superseded updates and summarizes or drops tool output. The bulk `/api/orchestration/snapshot` leaves thread bodies empty. See [http.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/http.ts), [ProjectionSnapshotQuery.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts), and [ActivityPayloadProjection.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/ActivityPayloadProjection.ts).

The official `auth session issue`/`revoke` commands can authenticate a headless client, but the inspected CLI grants administrative scopes. The bundled reader uses SQLite as chosen for this workflow. It does not issue sessions, start a server, or fall back between API and database reads. See the [auth CLI](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/auth.ts).
