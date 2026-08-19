# Slop(e)style

Kris's cross-machine collaboration contract and reusable skills for coding agents.

## Runtime and development checkouts

Each machine uses two separate checkouts:

- `~/.local/share/slopestyle` is the stable runtime. It stays on `main` and backs the installed Pi and Claude Code symlinks.
- A checkout under `~/dev/` is for branches, commits, and pull requests. Development branches never change active agent guidance.

The installer and synchronizer refuse to run from a development checkout.

## Bootstrap a machine

Clone the stable runtime:

```bash
git clone https://github.com/kristofferremback/slopestyle.git "$HOME/.local/share/slopestyle"
cd "$HOME/.local/share/slopestyle"
```

Review existing global guidance and skills, then install:

```bash
./scripts/install.sh
```

The installer automatically backs up and migrates the known unmodified external `unslop` installation. It refuses modified copies and every other existing file or skill directory. After reviewing a conflict, allow a one-time backup and replacement with:

```bash
./scripts/install.sh --replace
```

Install periodic synchronization:

```bash
./scripts/schedule-sync.sh install
```

Linux uses a systemd user timer. macOS uses a LaunchAgent. Both run after login and every 30 minutes.

## Synchronization behavior

`scripts/sync.sh` updates only a clean `main` checkout by fast-forwarding to `origin/main`. Before changing the runtime, it validates the fetched commit in a temporary worktree and checks local installation conflicts. It then fast-forwards the runtime, reconciles local links, and checks installed state.

The sync refuses dirty, divergent, detached, or non-`main` checkouts. It never resets, rebases, stashes, or discards changes. Concurrent runs cannot overlap, and the operating system releases the advisory lock after a crash. Failures return a nonzero status, write `~/.local/state/slopestyle/status`, and append details to a bounded `~/.local/state/slopestyle/sync.log`. Failures that need intervention request a desktop notification when the platform supports one. Fetch failures notify only after four consecutive attempts and recover silently when the network returns.

`origin/main` is a full-trust boundary because validation executes its checked-in scripts. Pull request review and passing CI are the controls before merge. Point the runtime remote only at the canonical repository.

Run or inspect synchronization manually:

```bash
./scripts/sync.sh
./scripts/schedule-sync.sh status
tail -f "$HOME/.local/state/slopestyle/sync.log"
```

Remove the scheduler without removing guidance or the checkout:

```bash
./scripts/schedule-sync.sh uninstall
```

Start fresh Pi and Claude Code sessions after an update. Existing sessions retain the guidance loaded at startup.

## Development

Use a separate checkout:

```bash
git clone git@github.com:kristofferremback/slopestyle.git "$HOME/dev/slopestyle"
cd "$HOME/dev/slopestyle"
```

Repository layout:

- `agents/`: shared global guidance loaded by Pi and Claude Code
- `skills/`: canonical Slop(e)style skills and their target manifest
- `scripts/install.sh`: safe runtime installation
- `scripts/sync.sh`: validated fast-forward synchronization
- `scripts/schedule-sync.sh`: Linux and macOS scheduler management
- `scripts/check.sh`: source and installed-state validation
- `tests/`: synchronization integration tests

Validate development changes with:

```bash
./scripts/check.sh
./tests/sync.sh
```

GitHub Actions runs both commands on Linux and macOS. Run `./scripts/check.sh --installed` from the stable runtime when checking active installation.

Unmodified vendor skills remain external dependencies. Patched skills live here as managed local forks with pinned provenance and a `PATCH.md` explaining every intentional delta. Seer stays a small pointer to its hosted skill.
