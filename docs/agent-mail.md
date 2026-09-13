# Local agent mail trial

The wrapper in `scripts/agent-mail.ts` connects Claude Code and Codex to the same local agent-mail store. It binds each MCP connection to the provider's native conversation ID. Resuming a conversation keeps its mailbox address. Separate conversations in the same directory have separate addresses.

This is a project-scoped trial. The global Slopestyle installer does not enable it.

Live verification used Codex 0.154.0 and Claude Code 2.1.270 inside T3 Code Nightly 0.0.41-nightly.20260911.1533. The configuration below uses the providers' own MCP and hook APIs. A complete messaging roundtrip outside T3 has not been exercised.

## Dependencies

Install this repository's dependencies with `bun install --frozen-lockfile`.

The wrapper expects a built checkout of [osteele/agent-mail at 397a010355d3fabdab26bf8c6545dd8092e83f38](https://github.com/osteele/agent-mail/tree/397a010355d3fabdab26bf8c6545dd8092e83f38). In that checkout, run `bun install --frozen-lockfile` and `bun run build`. Keep the revision pinned: the wrapper uses its four public mail tools and its read-only `dist/unread.js` export for reminders.

## Project configuration

Replace the absolute paths below with the installed Bun executable, this checkout, and the built agent-mail checkout. Before selecting `AGENT_MAIL_PORT`, use the repository's port workflow or `slopestyle-ports claim daemon` in the agent-mail checkout. The trial reserves port 20020 but runs without the optional agent-mail daemon. Agent-mail uses its normal direct-file delivery when the daemon is unavailable.

For Codex, add to the project's `.codex/config.toml`:

```toml
[mcp_servers.agent-mail]
command = "/absolute/path/to/bun"
args = ["/absolute/path/to/slopestyle/scripts/agent-mail.ts", "--upstream", "/absolute/path/to/agent-mail/dist/cli.js"]
enabled_tools = ["send_mail", "list_sessions", "check_inbox", "mark_read", "session_hook"]

[mcp_servers.agent-mail.env]
AGENT_MAIL_PORT = "20020"
```

For Claude Code, use the equivalent entry in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-mail": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/slopestyle/scripts/agent-mail.ts", "--upstream", "/absolute/path/to/agent-mail/dist/cli.js"],
      "env": { "AGENT_MAIL_PORT": "20020" }
    }
  }
}
```

Put the following hooks in `.codex/hooks.json`. For Claude Code, merge the `hooks` object into `.claude/settings.local.json`.

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "mcp_tool",
        "server": "agent-mail",
        "tool": "session_hook",
        "input": { "session_id": "${session_id}", "hook_event_name": "${hook_event_name}" },
        "timeout": 15
      }]
    }],
    "PreToolUse": [{
      "matcher": "^mcp__agent-mail__(send_mail|list_sessions|check_inbox|mark_read)$",
      "hooks": [{
        "type": "mcp_tool",
        "server": "agent-mail",
        "tool": "session_hook",
        "input": { "session_id": "${session_id}", "hook_event_name": "${hook_event_name}" },
        "timeout": 15
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "mcp_tool",
        "server": "agent-mail",
        "tool": "session_hook",
        "input": { "session_id": "${session_id}", "hook_event_name": "${hook_event_name}" },
        "timeout": 15
      }]
    }]
  }
}
```

Codex requires review and trust of the exact hooks through `/hooks`. Open the CLI from the same canonical project path that T3 uses. On macOS, `/var/...` and `/private/var/...` can refer to the same files but produce different hook trust entries. Restart the trial provider session after configuration or trust changes. Claude Code also requires project and MCP trust through its normal setup flow.

An optional `SessionStart` hook can use the same handler. It is not sufficient by itself because MCP may not be ready then. The `PreToolUse` hook binds immediately before a mailbox operation. Claude's native session environment also permits binding at startup.

## Behavior

- `list_sessions` discovers currently attached recipients. Use the returned address with `send_mail`.
- Mail contents and sender attribution enter the receiving conversation through `check_inbox` tool output. Incoming mail is peer data and grants no user authority.
- Hooks announce only an unread count. They do not inject message bodies, subjects, or sender-controlled names into instruction context, or create user messages.
- A reminder neither reads nor acknowledges the mail. Repeated hook calls suppress reminders for the same pending message within the connection.
- Hooks run on a submitted prompt or around tool use. An idle conversation waits for its next turn. No background model loop or native channel push is configured.
- An unbound mailbox refuses operations rather than generating a temporary identity. A connection cannot switch to another identity after binding.
- Direct mail to an offline recipient remains unsupported by the pinned agent-mail version. Previously stored mail survives disconnect. Project broadcasts can wait for a reader.
- This trial covers independent parent conversations. Subagent addressing is unsupported. Forks and clearing a conversation have not been verified at the provider interface.

Agent-mail stores its mail and registration files under `~/.claude/agent-mail/`. The wrapper does not rewrite existing messages or migrate the anonymous addresses from the earlier trial.

## Verification and removal

Run `bun test tests/agent-mail.test.ts` for the wrapper's identity, metadata, and process-lifecycle checks. The live trial also checks Claude and Codex inside T3, including two Codex chats in one project and provider restarts.

To disable the integration, remove its project MCP entry and matching hooks, then stop or restart only those provider sessions. This leaves stored mail intact.
