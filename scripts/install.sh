#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
stable_root="$HOME/.local/share/slopestyle"
manifest="$repo_root/skills/manifest.json"
replace=0
mode="install"
preflight_root=""

usage() {
  printf 'Usage: %s [--replace] [--preflight-for PATH]\n' "$0"
}

while (($#)); do
  case "$1" in
    --replace) replace=1 ;;
    --preflight-for)
      shift
      (($#)) || { printf '%s requires a path.\n' '--preflight-for' >&2; exit 2; }
      mode="preflight"
      preflight_root="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$mode" == "preflight" && $replace -eq 1 ]]; then
  printf 'Selected installation options cannot be combined.\n' >&2
  exit 2
fi

command -v python3 >/dev/null || {
  printf 'python3 is required to install Slop(e)style.\n' >&2
  exit 1
}

physical_path() {
  python3 - "$1" <<'PY'
import sys
from pathlib import Path
print(Path(sys.argv[1]).resolve())
PY
}

if [[ "$mode" == "install" ]]; then
  if [[ ! -d "$stable_root/.git" ]] || [[ "$(physical_path "$stable_root")" != "$repo_root" ]]; then
    printf 'Install from the stable runtime checkout at %s, not a development checkout.\n' "$stable_root" >&2
    exit 1
  fi
elif [[ "$mode" == "preflight" ]]; then
  if [[ ! -d "$preflight_root/.git" ]] || [[ "$(physical_path "$preflight_root")" != "$(physical_path "$stable_root")" ]]; then
    printf 'Preflight target must be the stable runtime checkout at %s.\n' "$stable_root" >&2
    exit 1
  fi
  preflight_root="$(physical_path "$preflight_root")"
fi

for legacy in "$HOME/.pi/agent/skills/threa-cli" "$HOME/.claude/skills/threa-cli"; do
  if [[ -e "$legacy" || -L "$legacy" ]]; then
    if [[ "$mode" == "preflight" || $replace -eq 0 ]]; then
      printf 'Legacy skill %s conflicts with canonical threa. Review it before using --replace.\n' "$legacy" >&2
      exit 1
    fi
  fi
done

legacy_unslop_hash="$(python3 - "$repo_root/skills/unslop/PATCH.md" <<'PY'
import re
import sys
from pathlib import Path

patch = Path(sys.argv[1]).read_text()
match = re.search(r"Unmodified `SKILL\.md` SHA-256: `([0-9a-f]{64})`", patch)
if not match:
    raise SystemExit("unslop PATCH.md is missing its upstream hash")
print(match.group(1))
PY
)"

is_exact_legacy_unslop() {
  local target="$1"
  [[ -f "$target/SKILL.md" ]] || return 1
  [[ "$(python3 - "$target" "$legacy_unslop_hash" <<'PY'
import hashlib
import sys
from pathlib import Path

directory = Path(sys.argv[1]).resolve()
entries = sorted(path.name for path in directory.iterdir())
skill_hash = hashlib.sha256((directory / "SKILL.md").read_bytes()).hexdigest()
print("yes" if entries == ["SKILL.md"] and skill_hash == sys.argv[2] else "no")
PY
)" == "yes" ]]
}

can_link() {
  local source="$1"
  local target="$2"

  if [[ -L "$target" ]] && [[ "$(readlink "$target")" == "$source" ]]; then
    return 0
  fi
  if [[ -L "$target" ]] && [[ "$(physical_path "$target")" == "$preflight_root/skills/"* ]]; then
    return 0
  fi
  if [[ "$source" == "$preflight_root/skills/unslop" ]] && is_exact_legacy_unslop "$target"; then
    return 0
  fi
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    return 0
  fi
  if [[ -f "$source" && -f "$target" ]] && cmp -s -- "$source" "$target"; then
    return 0
  fi
  printf 'Refusing to replace %s. Review it before using --replace.\n' "$target" >&2
  return 1
}

if [[ "$mode" == "preflight" ]]; then
  can_link "$preflight_root/agents/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
  can_link "$preflight_root/agents/AGENTS.md" "$HOME/.claude/AGENTS.md"
  can_link "$preflight_root/agents/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

  while IFS=$'\t' read -r name relative_path target; do
    case "$target" in
      pi) target_root="$HOME/.pi/agent/skills" ;;
      claude-code) target_root="$HOME/.claude/skills" ;;
      *) printf 'Unsupported skill target %s for %s\n' "$target" "$name" >&2; exit 1 ;;
    esac
    can_link "$preflight_root/$relative_path" "$target_root/$name"
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

  printf 'Slop(e)style installation preflight passed.\n'
  exit 0
fi

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
  local temporary="${target}.slopestyle.$$"

  mkdir -p -- "$(dirname "$target")"

  if [[ -L "$target" ]] && [[ "$(readlink "$target")" == "$source" ]]; then
    printf 'Already linked: %s\n' "$target"
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -f "$source" && -f "$target" ]] && cmp -s -- "$source" "$target"; then
      :
    elif [[ -L "$target" ]] && [[ "$(physical_path "$target")" == "$repo_root/skills/"* ]]; then
      :
    elif ((replace)); then
      backup_target "$target"
    else
      printf 'Refusing to replace %s. Re-run with --replace after reviewing it.\n' "$target" >&2
      return 1
    fi
  fi

  rm -f "$temporary"
  ln -s -- "$source" "$temporary"
  mv -f -- "$temporary" "$target"
  printf 'Linked %s -> %s\n' "$target" "$source"
}

for legacy in "$HOME/.pi/agent/skills/threa-cli" "$HOME/.claude/skills/threa-cli"; do
  if [[ -e "$legacy" || -L "$legacy" ]]; then
    backup_target "$legacy"
  fi
done

for target in "$HOME/.pi/agent/skills/unslop" "$HOME/.claude/skills/unslop"; do
  source="$repo_root/skills/unslop"
  if [[ -L "$target" ]] && [[ "$(readlink "$target")" == "$source" ]]; then
    continue
  fi
  if is_exact_legacy_unslop "$target"; then
    backup_target "$target"
    printf 'Migrating unmodified external unslop to the managed local fork.\n'
    continue
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    if ((replace)); then
      backup_target "$target"
    else
      printf 'Installed unslop differs from the pinned upstream base. Review it before using --replace: %s\n' "$target" >&2
      exit 1
    fi
  fi
done

link_owned "$repo_root/agents/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
link_owned "$repo_root/agents/AGENTS.md" "$HOME/.claude/AGENTS.md"
link_owned "$repo_root/agents/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

expected_pi='|'
expected_claude='|'
while IFS=$'\t' read -r name relative_path target; do
  case "$target" in
    pi)
      target_root="$HOME/.pi/agent/skills"
      expected_pi="${expected_pi}${name}|"
      ;;
    claude-code)
      target_root="$HOME/.claude/skills"
      expected_claude="${expected_claude}${name}|"
      ;;
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

remove_retired_links() {
  local target_root="$1"
  local expected="$2"
  local candidate name source

  [[ -d "$target_root" ]] || return
  for candidate in "$target_root"/*; do
    [[ -L "$candidate" ]] || continue
    source="$(physical_path "$candidate")"
    [[ "$source" == "$repo_root/skills/"* ]] || continue
    name="$(basename "$candidate")"
    case "$expected" in
      *"|$name|"*) ;;
      *)
        rm "$candidate"
        printf 'Removed retired Slop(e)style skill link: %s\n' "$candidate"
        ;;
    esac
  done
}

remove_retired_links "$HOME/.pi/agent/skills" "$expected_pi"
remove_retired_links "$HOME/.claude/skills" "$expected_claude"

printf 'Slop(e)style installation complete. Start fresh Pi and Claude Code sessions to load it.\n'
