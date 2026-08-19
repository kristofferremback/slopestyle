# Slop(e)style

Kris's cross-machine collaboration contract and reusable skills for coding agents.

## Layout

- `agents/`: shared global guidance loaded by Pi and Claude Code
- `skills/`: canonical Slop(e)style skills plus their target manifest
- `scripts/install.sh`: safe, repeatable global installation
- `scripts/check.sh`: source and installed-state validation

Unmodified vendor skills remain external dependencies. Patched skills live here as managed local forks with pinned provenance and a `PATCH.md` explaining every intentional delta. Seer stays a small pointer to its hosted skill.

## Install

Review the diff and existing global files first, then run:

```bash
./scripts/install.sh
```

The installer automatically backs up and migrates the known unmodified external `unslop` installation. It refuses modified copies and every other existing file or skill directory. After reviewing a conflict, allow a one-time backup and replacement with:

```bash
./scripts/install.sh --replace
```

Start fresh Pi and Claude Code sessions after installation.

## Verify

```bash
./scripts/check.sh
./scripts/check.sh --installed
```
