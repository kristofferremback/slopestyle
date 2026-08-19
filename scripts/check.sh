#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installed=0

if [[ "${1:-}" == "--installed" ]]; then
  installed=1
elif (($#)); then
  printf 'Usage: %s [--installed]\n' "$0" >&2
  exit 2
fi

bash -n "$repo_root/scripts/install.sh"

python3 - "$repo_root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
manifest_path = root / "skills/manifest.json"
manifest = json.loads(manifest_path.read_text())

if manifest.get("schemaVersion") != 1:
    raise SystemExit("skills/manifest.json must use schemaVersion 1")

expected_dirs = set()
names = set()
for skill in manifest.get("skills", []):
    name = skill.get("name", "")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise SystemExit(f"Invalid skill name in manifest: {name!r}")
    if name in names:
        raise SystemExit(f"Duplicate skill name in manifest: {name}")
    names.add(name)

    targets = skill.get("targets")
    if not targets or any(t not in {"pi", "claude-code"} for t in targets):
        raise SystemExit(f"Invalid targets for {name}: {targets}")

    provenance = skill.get("provenance")
    if provenance not in {"original", "adapted", "pointer", "synchronized"}:
        raise SystemExit(f"Invalid provenance for {name}: {provenance!r}")

    path = root / skill["path"]
    expected_dirs.add(path.resolve())
    skill_file = path / "SKILL.md"
    if not skill_file.is_file():
        raise SystemExit(f"Missing SKILL.md for {name}: {skill_file}")

    text = skill_file.read_text()
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        raise SystemExit(f"Missing YAML frontmatter: {skill_file}")
    frontmatter = match.group(1)
    found_name = re.search(r"^name:\s*['\"]?([^'\"\n]+)", frontmatter, re.M)
    description = re.search(r"^description:\s*(.+)$", frontmatter, re.M)
    if not found_name or found_name.group(1).strip() != name:
        raise SystemExit(f"Frontmatter name does not match directory for {name}")
    if not description or not description.group(1).strip():
        raise SystemExit(f"Missing description for {name}")
    if len(description.group(1).strip().strip("'\"")) > 1024:
        raise SystemExit(f"Description exceeds 1024 characters for {name}")

    if provenance == "adapted":
        for provenance_file in ("LICENSE", "NOTICE.md"):
            if not (path / provenance_file).is_file():
                raise SystemExit(f"Adapted skill {name} is missing {provenance_file}")
    if provenance == "synchronized":
        if not (path / "NOTICE.md").is_file():
            raise SystemExit(f"Synchronized skill {name} is missing NOTICE.md")
        if not str(skill.get("source", "")).startswith("https://"):
            raise SystemExit(f"Synchronized skill {name} needs a resolvable source URL")
        if not re.fullmatch(r"[0-9a-f]{40}", skill.get("upstreamCommit", "")):
            raise SystemExit(f"Synchronized skill {name} needs a pinned upstreamCommit")

actual_dirs = {
    path.parent.resolve()
    for path in (root / "skills").glob("*/SKILL.md")
}
missing = expected_dirs - actual_dirs
extra = actual_dirs - expected_dirs
if missing or extra:
    raise SystemExit(
        "Manifest mismatch. "
        f"Missing directories: {sorted(map(str, missing))}; "
        f"unlisted directories: {sorted(map(str, extra))}"
    )

for external in manifest.get("external", []):
    if external.get("name") in names:
        raise SystemExit(f"External skill duplicates a local skill: {external['name']}")
    if not external.get("package") or not external.get("targets"):
        raise SystemExit(f"Incomplete external skill entry: {external}")

print(f"Validated {len(expected_dirs)} local skills and {len(manifest.get('external', []))} external skills.")
PY

(
  cd "$repo_root/skills/writing-for-agents"
  sha256sum --check <(printf '%s  SKILL.md\n' "$(<UPSTREAM.sha256)")
)

if ((installed)); then
  check_link() {
    local target="$1"
    local source="$2"
    if [[ ! -L "$target" ]]; then
      printf 'Expected installed symlink: %s\n' "$target" >&2
      exit 1
    fi
    if [[ "$(readlink -f "$target")" != "$(readlink -f "$source")" ]]; then
      printf 'Wrong installed target: %s\n' "$target" >&2
      exit 1
    fi
  }

  check_link "$HOME/.pi/agent/AGENTS.md" "$repo_root/agents/AGENTS.md"
  check_link "$HOME/.claude/AGENTS.md" "$repo_root/agents/AGENTS.md"
  check_link "$HOME/.claude/CLAUDE.md" "$repo_root/agents/CLAUDE.md"

  while IFS=$'\t' read -r name relative_path target; do
    case "$target" in
      pi) target_root="$HOME/.pi/agent/skills" ;;
      claude-code) target_root="$HOME/.claude/skills" ;;
    esac
    check_link "$target_root/$name" "$repo_root/$relative_path"
  done < <(
    python3 - "$repo_root/skills/manifest.json" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1]))
for skill in manifest["skills"]:
    for target in skill["targets"]:
        print(f'{skill["name"]}\t{skill["path"]}\t{target}')
PY
  )

  for target in "$HOME/.pi/agent/skills/unslop" "$HOME/.claude/skills/unslop"; do
    if [[ ! -e "$target/SKILL.md" ]]; then
      printf 'Missing required upstream unslop skill: %s\n' "$target" >&2
      exit 1
    fi
  done
fi

printf 'Slopestyle checks passed.\n'
