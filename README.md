# Slop(e)style

Kris's cross-machine collaboration contract and reusable skills for coding agents.

## Runtime and development checkouts

Each machine uses two separate checkouts:

- `~/.local/share/slopestyle` is the stable runtime. It stays on `main` and backs the installed Pi and Claude Code symlinks.
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

The installer automatically backs up and migrates the known unmodified external `unslop` installation. It refuses modified copies and every other existing file or skill directory. After reviewing a conflict, allow a one-time backup and replacement with:

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

Start fresh Pi and Claude Code sessions after an update. Existing sessions retain the guidance loaded at startup.

## Heavy local checks

The installer links `slopestyle-heavy` into `~/.local/bin`. It holds a user-wide SQLite lock while the wrapped command runs, so agents and worktrees under the same account queue resource-heavy local checks instead of exhausting memory. SQLite releases a crashed owner's lock. Catchable termination signals propagate to the wrapped process group, and waiting exits with status 75 after 30 minutes by default.

```bash
"$HOME/.local/bin/slopestyle-heavy" -- bun test path/to/focused.test.ts
"$HOME/.local/bin/slopestyle-heavy" --label "commit hooks" -- git commit -m "..."
```

Use the wrapper for repository-wide lint, typecheck, build, browser, end-to-end, and worker-pool commands. Nested wrapper calls reuse the outer guard. CI remains responsible for full suites unless repository guidance or a named risk requires local proof.

## Development

Use a separate checkout:

```bash
git clone git@github.com:kristofferremback/slopestyle.git "$HOME/dev/slopestyle"
cd "$HOME/dev/slopestyle"
```

Repository layout:

- `agents/`: shared global guidance loaded by Pi and Claude Code
- `skills/`: canonical Slop(e)style skills and their target manifest
- `scripts/install.ts`: safe runtime installation
- `scripts/heavy-check.ts`: user-wide serialization for resource-heavy local commands
- `scripts/sync.ts`: validated fast-forward synchronization
- `scripts/schedule-sync.ts`: Linux and macOS scheduler management
- `scripts/check.ts`: source and installed-state validation
- `scripts/lib/`: shared TypeScript primitives
- `scripts/*.sh`: compatibility handoff only; no workflow logic
- `tests/`: synchronization integration tests

Install pinned development dependencies and validate changes with:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run check
bun test
```

GitHub Actions runs the same commands on Linux and macOS. Run `./scripts/check.ts --installed` from the stable runtime when checking active installation.

Unmodified vendor skills remain external dependencies. Patched skills live here as managed local forks with pinned provenance and a `PATCH.md` explaining every intentional delta. Seer stays a small pointer to its hosted skill.
