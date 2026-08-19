#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/skills/manifest.json"
replace=0
skip_external=0

usage() {
  printf 'Usage: %s [--replace] [--skip-external]\n' "$0"
}

while (($#)); do
  case "$1" in
    --replace) replace=1 ;;
    --skip-external) skip_external=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

backup_target() {
  local target="$1"
  local stamp relative backup
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  relative="${target#"$HOME"/}"
  backup="$HOME/.slopestyle/backups/$stamp/$relative"
  while [[ -e "$backup" || -L "$backup" ]]; do
    backup="${backup}-1"
  done
  mkdir -p -- "$(dirname "$backup")"
  mv -- "$target" "$backup"
  printf 'Backed up %s to %s\n' "$target" "$backup"
}

link_owned() {
  local source="$1"
  local target="$2"

  mkdir -p -- "$(dirname "$target")"

  if [[ -L "$target" ]] && [[ "$(readlink "$target")" == "$source" ]]; then
    printf 'Already linked: %s\n' "$target"
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -f "$source" && -f "$target" ]] && cmp -s -- "$source" "$target"; then
      rm -- "$target"
    elif ((replace)); then
      backup_target "$target"
    else
      printf 'Refusing to replace %s. Re-run with --replace after reviewing it.\n' "$target" >&2
      return 1
    fi
  fi

  ln -s -- "$source" "$target"
  printf 'Linked %s -> %s\n' "$target" "$source"
}

if ((!skip_external)); then
  command -v npx >/dev/null || {
    printf 'npx is required to install upstream skills.\n' >&2
    exit 1
  }
  npx -y skills@1.5.23 add \
    https://github.com/cursor/plugins/tree/main/pstack \
    --global \
    --agent pi \
    --agent claude-code \
    --skill unslop \
    --yes
fi

for legacy in "$HOME/.pi/agent/skills/threa-cli" "$HOME/.claude/skills/threa-cli"; do
  if [[ -e "$legacy" || -L "$legacy" ]]; then
    if ((replace)); then
      backup_target "$legacy"
    else
      printf 'Legacy skill %s conflicts with canonical threa. Re-run with --replace after reviewing it.\n' "$legacy" >&2
      exit 1
    fi
  fi
done

link_owned "$repo_root/agents/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
link_owned "$repo_root/agents/AGENTS.md" "$HOME/.claude/AGENTS.md"
link_owned "$repo_root/agents/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

while IFS=$'\t' read -r name relative_path target; do
  case "$target" in
    pi) target_root="$HOME/.pi/agent/skills" ;;
    claude-code) target_root="$HOME/.claude/skills" ;;
    *) printf 'Unsupported skill target %s for %s\n' "$target" "$name" >&2; exit 1 ;;
  esac
  link_owned "$repo_root/$relative_path" "$target_root/$name"
done < <(
  python3 - "$manifest" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1]))
for skill in manifest["skills"]:
    for target in skill["targets"]:
        print(f'{skill["name"]}\t{skill["path"]}\t{target}')
PY
)

printf 'Slopestyle installation complete. Start fresh Pi and Claude Code sessions to load it.\n'
