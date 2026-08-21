# Slop(e)style

This repository is the source of truth for Kris's cross-machine agent setup.

- Shared global guidance belongs in `agents/`.
- Reusable skills live in one self-contained `skills/<name>/` directory.
- Vendor skills remain external unless a documented incompatibility requires adaptation.
- Load `writing-for-agents` before changing agent guidance or skills.
- Keep runtime skill descriptions short and trigger-first. Bodies own workflow details.
- Before committing, run `bun run check`, `scripts/heavy-check.ts -- bun run typecheck`, and `scripts/heavy-check.ts -- bun test`. The full suite is intentional here because it is small and protects cross-platform installation and synchronization.
- Run `scripts/install.ts` only when changing the active global installation.
- Stage only owned files. Never commit `.threa-attachments/`.
