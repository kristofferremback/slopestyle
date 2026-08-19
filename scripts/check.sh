#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
installed=0

if [[ "${1:-}" == "--installed" ]]; then
  installed=1
elif (($#)); then
  printf 'Usage: %s [--installed]\n' "$0" >&2
  exit 2
fi

while IFS= read -r script; do
  bash -n "$script"
  if [[ ! -x "$script" ]]; then
    printf 'Shell entry point is not executable: %s\n' "$script" >&2
    exit 1
  fi
done < <(find "$repo_root/scripts" "$repo_root/tests" -type f -name '*.sh' -print 2>/dev/null | sort)

python3 - "$repo_root" <<'PY'
import hashlib
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
    if provenance not in {"original", "adapted", "forked", "pointer", "synchronized"}:
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
    if provenance == "forked":
        for provenance_file in ("LICENSE", "NOTICE.md", "PATCH.md"):
            if not (path / provenance_file).is_file():
                raise SystemExit(f"Forked skill {name} is missing {provenance_file}")
        upstream_commit = skill.get("upstreamCommit", "")
        if not str(skill.get("source", "")).startswith("https://"):
            raise SystemExit(f"Forked skill {name} needs a resolvable source URL")
        if not re.fullmatch(r"[0-9a-f]{40}", upstream_commit):
            raise SystemExit(f"Forked skill {name} needs a pinned upstreamCommit")
        notice = (path / "NOTICE.md").read_text()
        patch = (path / "PATCH.md").read_text()
        if upstream_commit not in notice or upstream_commit not in patch:
            raise SystemExit(f"Forked skill {name} metadata does not match upstreamCommit")
        if not re.search(r"Unmodified `SKILL\.md` SHA-256: `[0-9a-f]{64}`", patch):
            raise SystemExit(f"Forked skill {name} PATCH.md needs its unmodified upstream hash")
        fork_hash = re.search(r"Current fork `SKILL\.md` SHA-256: `([0-9a-f]{64})`", patch)
        actual_fork_hash = hashlib.sha256(skill_file.read_bytes()).hexdigest()
        if not fork_hash or fork_hash.group(1) != actual_fork_hash:
            raise SystemExit(f"Forked skill {name} PATCH.md does not match its current SKILL.md")
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

external_names = set()
for external in manifest.get("external", []):
    name = external.get("name", "")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise SystemExit(f"Invalid external skill name: {name!r}")
    if name in names or name in external_names:
        raise SystemExit(f"Duplicate local or external skill: {name}")
    external_names.add(name)
    targets = external.get("targets")
    if not external.get("package") or not targets or any(t not in {"pi", "claude-code"} for t in targets):
        raise SystemExit(f"Incomplete external skill entry: {external}")

print(f"Validated {len(expected_dirs)} local skills and {len(manifest.get('external', []))} external skills.")
PY

python3 - "$repo_root/skills/writing-for-agents/UPSTREAM.sha256" "$repo_root/skills/writing-for-agents/SKILL.md" <<'PY'
import hashlib
import sys
from pathlib import Path

checksum_path = Path(sys.argv[1])
skill_path = Path(sys.argv[2])
expected = checksum_path.read_text().strip()
actual = hashlib.sha256(skill_path.read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit(f"{skill_path}: checksum mismatch")
print(f"{skill_path.name}: OK")
PY

if ((installed)); then
  check_link() {
    local target="$1"
    local source="$2"
    if [[ ! -L "$target" ]]; then
      printf 'Expected installed symlink: %s\n' "$target" >&2
      exit 1
    fi
    local resolved_target resolved_source
    resolved_target="$(python3 - "$target" <<'PY'
import sys
from pathlib import Path
print(Path(sys.argv[1]).resolve())
PY
)"
    resolved_source="$(python3 - "$source" <<'PY'
import sys
from pathlib import Path
print(Path(sys.argv[1]).resolve())
PY
)"
    if [[ "$resolved_target" != "$resolved_source" ]]; then
      printf 'Wrong installed target: %s\n' "$target" >&2
      exit 1
    fi
  }

  check_link "$HOME/.pi/agent/AGENTS.md" "$repo_root/agents/AGENTS.md"
  check_link "$HOME/.claude/AGENTS.md" "$repo_root/agents/AGENTS.md"
  check_link "$HOME/.claude/CLAUDE.md" "$repo_root/agents/CLAUDE.md"

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

  check_retired_links() {
    local target_root="$1"
    local expected="$2"
    local candidate name source

    [[ -d "$target_root" ]] || return
    for candidate in "$target_root"/*; do
      [[ -L "$candidate" ]] || continue
      source="$(python3 - "$candidate" <<'PY'
import sys
from pathlib import Path
print(Path(sys.argv[1]).resolve())
PY
)"
      [[ "$source" == "$repo_root/skills/"* ]] || continue
      name="$(basename "$candidate")"
      case "$expected" in
        *"|$name|"*) ;;
        *)
          printf 'Retired Slop(e)style skill link remains installed: %s\n' "$candidate" >&2
          exit 1
          ;;
      esac
    done
  }

  check_retired_links "$HOME/.pi/agent/skills" "$expected_pi"
  check_retired_links "$HOME/.claude/skills" "$expected_claude"

fi

printf 'Slop(e)style checks passed.\n'
