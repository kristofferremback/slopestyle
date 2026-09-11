# Slop(e)style

Kris's cross-machine collaboration contract and reusable skills for coding agents.

## Runtime and development checkouts

Each machine uses two separate checkouts:

- `~/.local/share/slopestyle` is the stable runtime. It stays on `main` and backs the installed Pi, Claude Code, and Codex symlinks.
- A checkout under `~/dev/` is for branches, commits, and pull requests. Development branches never change active agent guidance.

The installer and synchronizer refuse to run from a development checkout. Automation requires the Bun version in `.bun-version` or a newer compatible release on every machine. Thin `.sh` wrappers remain only so machines running the previous scheduler can hand off to the TypeScript entry points.

## Bootstrap a machine

Clone the stable runtime:

```bash
git clone https://github.com/kristofferremback/slopestyle.git "$HOME/.local/share/slopestyle"
cd "$HOME/.local/share/slopestyle"
```

Review existing global guidance and skills, then install:

```bash
./scripts/install.ts
```

The machine must match a host in `hosts.json`. See [host selection](#host-selection) when registering or renaming a machine.

The installer automatically backs up and migrates the known unmodified external `unslop` installation and the [original Datadog directory](#host-selection). It refuses modified copies and other existing files or skill directories. After reviewing an ordinary installation conflict, allow a one-time backup and replacement with:

```bash
./scripts/install.ts --replace
```

Install periodic synchronization:

```bash
./scripts/schedule-sync.ts install
```

Linux uses a systemd user timer. macOS uses a LaunchAgent. Both run after login and every 30 minutes.

### Migrating from the shell release

Install the Bun version from `.bun-version` before pulling this release. Run `./scripts/sync.sh` once from an interactive shell so the compatibility wrapper can hand off with the current `PATH`. The installer rewrites an existing timer or LaunchAgent to invoke Bun and `sync.ts` directly.

Raise the minimum Bun version only after every machine can run it. CI reads the same `.bun-version` file.

## Synchronization behavior

`scripts/sync.ts` updates only a clean `main` checkout by fast-forwarding to `origin/main`. Before changing the runtime, it validates the fetched commit in a temporary worktree and checks local installation conflicts. It then fast-forwards the runtime, reconciles local links, and checks installed state.

The sync refuses dirty, divergent, detached, or non-`main` checkouts. It never resets, rebases, stashes, or discards changes. A SQLite transaction prevents concurrent runs and releases automatically after a crash. Failures return a nonzero status, write `~/.local/state/slopestyle/status`, and append details to a bounded `~/.local/state/slopestyle/sync.log`. Failures that need intervention request a desktop notification when the platform supports one. Fetch failures notify only after four consecutive attempts and recover silently when the network returns.

`origin/main` is a full-trust boundary because validation executes its checked-in scripts. Pull request review and passing CI are the controls before merge. Point the runtime remote only at the canonical repository.

Run or inspect synchronization manually:

```bash
./scripts/sync.ts
./scripts/schedule-sync.ts status
tail -f "$HOME/.local/state/slopestyle/sync.log"
```

Remove the scheduler without removing guidance or the checkout:

```bash
./scripts/schedule-sync.ts uninstall
```

Start fresh Pi, Claude Code, and Codex sessions after an update. Existing sessions retain the guidance loaded at startup.

## Host selection

`hosts.json` registers `kristoffers-macbook-pro` and `homelab`, using their Tailscale node names as IDs. The installer matches the local OS hostname against those IDs and their aliases, ignoring case and a trailing dot. It does not contact Tailscale. The laptop's `Kristoffers-MacBook-Pro.local` alias covers its macOS hostname.

To assign a machine explicitly, write a registered ID to `~/.config/slopestyle/host`:

```bash
mkdir -p "$HOME/.config/slopestyle"
echo homelab > "$HOME/.config/slopestyle/host"
```

The pin takes precedence over hostname matching and applies to scheduled sync too. An unknown hostname or invalid pin stops installation, installed-state checks, and sync preflight before links change. Add the machine to the registry or correct its pin, then rerun sync. Source-only checks validate the registry without requiring CI machines to be registered.

The registry's `skills` and `subagents` maps restrict managed entries by name. An omitted entry is shared across registered hosts. An empty list disables it everywhere. For example:

```json
{
  "skills": {
    "datadog": ["kristoffers-macbook-pro"]
  },
  "subagents": {
    "opus-high": ["homelab"]
  }
}
```

This example shows the two restriction maps. The checked-in registry restricts only Datadog. Its `hosts` map defines machine IDs and their `aliases`. Unknown skill, subagent, or host names and ambiguous aliases fail validation.

Installation, preflight, and `check.ts --installed` use the same host selection. Sync removes excluded Slopestyle symlinks and installs newly enabled entries. Unrelated local files, vendor skills, shared global guidance, and command-line tools remain outside these restrictions. Host selection controls discovery through managed installations, not filesystem access to skill sources.

Datadog includes a one-time migration for the original `~/.codex/skills/datadog` directory. After installing the selected skills and subagents, installation backs up that exact known copy under `~/.slopestyle/backups`. This also removes the old copy from discovery on a host where Datadog is excluded. Extra entries, symlinks, or changed content stop migration, including with `--replace`. Review and move a changed copy outside the skills directories before retrying. The migrated skill resolves its helper relative to its own directory.

## Usage dashboard

`scripts/usage.ts` installs as `~/.local/bin/slopestyle-usage`. It indexes every Claude Code transcript under `~/.claude/projects` into `~/.local/state/slopestyle/usage.sqlite`, prices each request at API list prices as a proxy for subscription usage, and polls the plan's 5-hour and weekly limits with the OAuth token Claude Code keeps in its credentials.

```bash
slopestyle-usage serve                 # page on a slopestyle-ports port, bound to 127.0.0.1
slopestyle-usage report --since 13:00  # spend by session, limits, and insights in the terminal
```

The page shows spend and input and output tokens per session over a range, defaulting to today, with subagents rolled into their parent and the share of input read from cache, drilldown into a session's context growth and compactions, the current limit percentages with their windows, and rule-based insights. It reloads every 10 seconds while the tab is visible, and Refresh re-indexes transcripts and polls the limits right away. Drag across any chart to zoom into that span; the arrow above the chart steps back out. `slopestyle-ports serve usage` exposes it over Tailscale. The `quota` skill points agents at the same `report --json` output and the `/api` routes.

Keep the server running in the background:

```bash
slopestyle-usage service install    # LaunchAgent on macOS, systemd user service on Linux
slopestyle-usage service status
slopestyle-usage service uninstall
```

The service starts at login and restarts after a crash. The installer restarts it after every sync so it serves the current code. On macOS it runs in the login session, which is what the Keychain needs for the limit percentages.

## Local development ports

`scripts/ports.ts` installs as `~/.local/bin/slopestyle-ports`. It leases aligned blocks of ten ports from the managed range `20000`-`29999` so every checkout keeps one stable set of numbers, and so a browser origin is never reused by a different application.

Claim once per checkout and read the ports it prints:

```bash
slopestyle-ports claim frontend api
```

Or bind them straight into the shell that starts the servers:

```bash
ports="$(slopestyle-ports claim --format=sh frontend api)" \
  && eval "$ports" \
  && bun run dev --port "$SLOPESTYLE_PORT_FRONTEND"
```

The assignment runs before `eval`, so a failed `claim` stops the chain instead of
being swallowed by `eval` and starting the server with an empty `--port`.

`slopestyle-ports show` prints this checkout's lease, `show --all` prints every lease on the machine, and `release` gives the block back.

All linked worktrees of one repository share an app identity and its service offsets, so `frontend` keeps the same offset everywhere, while each worktree gets its own block. Outside a Git worktree, pass `--app NAME` to group checkouts manually.

Lifetime is explicit. A block ever assigned to an app stays owned by that app on this machine, so a released block can only ever come back to the same app. A live checkout keeps its lease until `release`, even while nothing is running. A block is active while any of its ports has a local listener or a Tailscale Serve route; `claim` and `release` report the conflict and exit nonzero rather than allocating a second block or dropping a live one. Nothing is ever killed or rewritten on your behalf.

Servers must bind `127.0.0.1`. The Tailscale HTTPS port equals the local port, which keeps one number to remember and one origin per service:

```bash
slopestyle-ports serve frontend
slopestyle-ports unserve frontend
```

`serve` requires a listener bound to `127.0.0.1:PORT` exactly, since that is the address Tailscale proxies to, so a wildcard, IPv6-only, or `127.0.0.2` bind is refused. It leaves any route that is not the exact route for that service alone. `unserve` removes the port only when it carries the exclusive shape this CLI creates: one HTTPS entry with a single `/` handler proxying to `http://127.0.0.1:PORT`. Because `tailscale serve --https=PORT off` deletes the whole port, any extra path or host entry sharing it is reported and left untouched. Claim and show print the future Tailscale URL as reserved; it becomes live only after `serve`. Without the Tailscale CLI local allocation still works and these two commands fail with installation guidance. State lives in `~/.local/state/slopestyle/ports.sqlite`, and concurrent allocations serialize through a SQLite transaction. Run `slopestyle-ports --help` for the full contract.

## Development

Use a separate checkout:

```bash
git clone git@github.com:kristofferremback/slopestyle.git "$HOME/dev/slopestyle"
cd "$HOME/dev/slopestyle"
```

Repository layout:

- `agents/`: shared global guidance loaded by Pi, Claude Code, and Codex
- `hosts.json`: registered machines and restrictions for managed skills and subagents
- `skills/`: canonical Slop(e)style skills and their target manifest
- `subagents/`: generated Claude Code subagent definitions, one per model and effort
- `scripts/install.ts`: safe runtime installation
- `scripts/sync.ts`: validated fast-forward synchronization
- `scripts/schedule-sync.ts`: Linux and macOS scheduler management
- `scripts/check.ts`: source and installed-state validation
- `scripts/ports.ts`: persistent local and Tailscale port allocation
- `scripts/subagents.ts`: regenerate `subagents/` from the matrix in `scripts/lib/subagents.ts`
- `scripts/lib/`: shared TypeScript primitives
- `scripts/*.sh`: compatibility handoff only; no workflow logic
- `tests/`: synchronization and port allocation integration tests

Install pinned development dependencies and validate changes with:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run check
bun test
```

GitHub Actions runs the same commands on Linux and macOS. Run `./scripts/check.ts --installed` from the stable runtime when checking active installation.

Unmodified vendor skills remain external dependencies. Patched skills live here as managed local forks with pinned provenance and a `PATCH.md` explaining every intentional delta. Seer stays a small pointer to its hosted skill.
