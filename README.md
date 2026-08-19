# Slopestyle

Kris's cross-machine collaboration contract and reusable skills for coding agents.

## Layout

- `agents/`: shared global guidance loaded by Pi and Claude Code
- `skills/`: canonical Slopestyle skills plus their target manifest
- `scripts/install.sh`: safe, repeatable global installation
- `scripts/check.sh`: source and installed-state validation

Vendor-hosted skills remain external dependencies. Slopestyle installs pstack's upstream `unslop` rather than maintaining another writing-pattern catalog. Seer stays a small pointer to its hosted skill.

## Install

Review the diff and existing global files first, then run:

```bash
./scripts/install.sh
```

The installer refuses to replace existing files or skill directories. After reviewing a conflict, allow a one-time backup and replacement with:

```bash
./scripts/install.sh --replace
```

Start fresh Pi and Claude Code sessions after installation.

## Verify

```bash
./scripts/check.sh
./scripts/check.sh --installed
```
