#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/slopestyle-sync-test.XXXXXX")"
test_home="$tmp/home"
publisher="$tmp/publisher"
remote="$tmp/remote.git"
runtime="$test_home/.local/share/slopestyle"
lock_holder=""

cleanup() {
  if [[ -n "$lock_holder" ]]; then
    kill "$lock_holder" >/dev/null 2>&1 || true
    wait "$lock_holder" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

commit_all() {
  local repository="$1"
  local message="$2"
  git -C "$repository" add -A
  git -C "$repository" -c user.name='Slopestyle Test' -c user.email='test@example.com' commit -q -m "$message"
}

expect_sync_failure() {
  if HOME="$test_home" "$runtime/scripts/sync.sh"; then
    fail "$1"
  fi
}

mkdir -p "$test_home" "$publisher"
git init -q --bare "$remote"
git -C "$remote" symbolic-ref HEAD refs/heads/main
git init -q "$publisher"
git -C "$publisher" checkout -q -b main
(
  cd "$source_root"
  tar --exclude='.git' -cf - .
) | (
  cd "$publisher"
  tar -xf -
)
commit_all "$publisher" 'Seed runtime'
git -C "$publisher" remote add origin "$remote"
git -C "$publisher" push -q -u origin main
git clone -q "$remote" "$runtime"

notify_bin="$tmp/notify-bin"
notify_log="$tmp/notifications.log"
mkdir -p "$notify_bin"
cat > "$notify_bin/notify-send" <<'EOF'
#!/usr/bin/env bash
printf 'notify-send %s\n' "$*" >> "$SLOPESTYLE_TEST_NOTIFY_LOG"
EOF
cat > "$notify_bin/osascript" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'osascript %s\n' "$*" >> "$SLOPESTYLE_TEST_NOTIFY_LOG"
EOF
chmod +x "$notify_bin/notify-send" "$notify_bin/osascript"
: > "$notify_log"
export PATH="$notify_bin:$PATH"
export SLOPESTYLE_TEST_NOTIFY_LOG="$notify_log"

HOME="$test_home" "$runtime/scripts/install.sh" >/dev/null
HOME="$test_home" "$runtime/scripts/check.sh" --installed >/dev/null
mkdir -p "$test_home/.agents/skills/unslop"
upstream_hash="$(python3 - "$runtime/skills/unslop/PATCH.md" <<'PY'
import re
import sys
from pathlib import Path
match = re.search(r"Unmodified `SKILL\.md` SHA-256: `([0-9a-f]{64})`", Path(sys.argv[1]).read_text())
print(match.group(1) if match else "")
PY
)"
python3 - "$runtime/skills/unslop/SKILL.md" "$test_home/.agents/skills/unslop/SKILL.md" "$upstream_hash" <<'PY'
import hashlib
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text().splitlines()
source = source[:-1]
content = "\n".join(source) + "\n"
if hashlib.sha256(content.encode()).hexdigest() != sys.argv[3]:
    raise SystemExit("could not reconstruct the pinned upstream unslop fixture")
Path(sys.argv[2]).write_text(content)
PY
rm "$test_home/.pi/agent/skills/unslop"
ln -s ../../../.agents/skills/unslop "$test_home/.pi/agent/skills/unslop"
HOME="$test_home" "$runtime/scripts/install.sh" --preflight-for "$runtime" >/dev/null
HOME="$test_home" "$runtime/scripts/install.sh" >/dev/null
HOME="$test_home" "$runtime/scripts/check.sh" --installed >/dev/null
ln -s "$runtime/skills/retired" "$test_home/.pi/agent/skills/retired"
if HOME="$test_home" "$runtime/scripts/check.sh" --installed >/dev/null 2>&1; then
  fail 'installed check accepted a retired owned skill link'
fi
HOME="$test_home" "$runtime/scripts/install.sh" >/dev/null
[[ ! -L "$test_home/.pi/agent/skills/retired" ]] || fail 'installer kept a retired owned skill link'
rm "$test_home/.pi/agent/skills/why"
ln -s "$runtime/skills/old-why" "$test_home/.pi/agent/skills/why"
HOME="$test_home" "$runtime/scripts/install.sh" >/dev/null
python3 - "$test_home/.pi/agent/skills/why" "$runtime/skills/why" <<'PY'
import sys
from pathlib import Path
if Path(sys.argv[1]).resolve() != Path(sys.argv[2]).resolve():
    raise SystemExit("installer did not update a relocated owned skill link")
PY
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null

grep -q ' success commit=' "$test_home/.local/state/slopestyle/status" || fail 'current runtime did not record success'

runtime_origin="$(git -C "$runtime" remote get-url origin)"
git -C "$runtime" remote set-url origin "$tmp/missing-remote.git"
for expected_failures in 1 2 3 4; do
  expect_sync_failure 'unavailable origin unexpectedly synced'
  [[ "$(<"$test_home/.local/state/slopestyle/fetch-failures")" == "$expected_failures" ]] || fail 'fetch failure count is incorrect'
  notification_count="$(wc -l < "$notify_log" | tr -d ' ')"
  if ((expected_failures < 4)); then
    [[ "$notification_count" == '0' ]] || fail 'transient fetch failure sent a notification too early'
  else
    [[ "$notification_count" == '1' ]] || fail 'fourth fetch failure did not send exactly one notification'
  fi
done
git -C "$runtime" remote set-url origin "$runtime_origin"
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null
[[ ! -e "$test_home/.local/state/slopestyle/fetch-failures" ]] || fail 'successful sync did not clear fetch failures'

fake_bin="$tmp/fake-bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/uname" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$SLOPESTYLE_TEST_PLATFORM"
EOF
cat > "$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "$SLOPESTYLE_TEST_COMMAND_LOG"
EOF
cat > "$fake_bin/launchctl" <<'EOF'
#!/usr/bin/env bash
printf 'launchctl %s\n' "$*" >> "$SLOPESTYLE_TEST_COMMAND_LOG"
if [[ "${1:-}" == 'print' ]]; then
  exit 1
fi
EOF
chmod +x "$fake_bin/uname" "$fake_bin/systemctl" "$fake_bin/launchctl"
command_log="$tmp/scheduler-commands.log"
if HOME="$test_home" "$source_root/scripts/install.sh" >/dev/null 2>&1; then
  fail 'installer accepted a development checkout'
fi
if HOME="$test_home" "$source_root/scripts/sync.sh" >/dev/null 2>&1; then
  fail 'synchronizer accepted a development checkout'
fi
if PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_PLATFORM=Linux SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$source_root/scripts/schedule-sync.sh" install >/dev/null 2>&1; then
  fail 'scheduler accepted a development checkout'
fi

PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_PLATFORM=Linux SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$runtime/scripts/schedule-sync.sh" install >/dev/null
grep -q "ExecStart=$runtime/scripts/sync.sh" "$test_home/.config/systemd/user/slopestyle-sync.service" || fail 'Linux service points at the wrong checkout'
PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_PLATFORM=Linux SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$runtime/scripts/schedule-sync.sh" uninstall >/dev/null
[[ ! -e "$test_home/.config/systemd/user/slopestyle-sync.timer" ]] || fail 'Linux timer was not removed'

PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_PLATFORM=Darwin SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$runtime/scripts/schedule-sync.sh" install >/dev/null
python3 - "$test_home/Library/LaunchAgents/dev.slopestyle.sync.plist" "$runtime" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as file:
    data = plistlib.load(file)
expected = f"{sys.argv[2]}/scripts/sync.sh"
if data["ProgramArguments"] != [expected] or data["StartInterval"] != 1800:
    raise SystemExit("macOS LaunchAgent has the wrong synchronization contract")
if not data["EnvironmentVariables"]["PATH"]:
    raise SystemExit("macOS LaunchAgent is missing its tool PATH")
if data["EnvironmentVariables"].get("SLOPESTYLE_LAUNCHD") != "1":
    raise SystemExit("macOS LaunchAgent is missing its launchd marker")
if data["StandardOutPath"] != data["StandardErrorPath"] or not data["StandardOutPath"].endswith("/slopestyle/sync.log"):
    raise SystemExit("macOS LaunchAgent does not preserve startup failures")
PY
PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_PLATFORM=Darwin SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$runtime/scripts/schedule-sync.sh" uninstall >/dev/null
[[ ! -e "$test_home/Library/LaunchAgents/dev.slopestyle.sync.plist" ]] || fail 'macOS LaunchAgent was not removed'

git -C "$runtime" checkout -q -b non-main
expect_sync_failure 'non-main runtime checkout was updated'
grep -q 'failure phase=checking runtime checkout' "$test_home/.local/state/slopestyle/status" || fail 'non-main failure was not recorded'
git -C "$runtime" checkout -q main
git -C "$runtime" branch -q -D non-main

lock_ready="$tmp/lock-ready"
python3 - "$test_home/.local/state/slopestyle/sync.lock" "$lock_ready" <<'PY' &
import fcntl
import os
import sys
import time

lock = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(lock, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(30)
PY
lock_holder=$!
for _ in 1 2 3 4 5; do
  [[ -e "$lock_ready" ]] && break
  sleep 0.1
done
[[ -e "$lock_ready" ]] || fail 'test lock holder did not start'
status_before_contention="$(<"$test_home/.local/state/slopestyle/status")"
set +e
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null 2>&1
contention_status=$?
set -e
[[ "$contention_status" == '75' ]] || fail 'overlapping sync did not return temporary-failure status'
[[ "$(<"$test_home/.local/state/slopestyle/status")" == "$status_before_contention" ]] || fail 'benign lock contention overwrote sync status'
kill "$lock_holder"
wait "$lock_holder" 2>/dev/null || true
lock_holder=""
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null

printf '%s\n' 'first update' > "$publisher/sync-test-marker"
commit_all "$publisher" 'Add first update'
git -C "$publisher" push -q
first_target="$(git -C "$publisher" rev-parse HEAD)"
before_conflict="$(git -C "$runtime" rev-parse HEAD)"
rm "$test_home/.pi/agent/AGENTS.md"
printf '%s\n' 'local conflict' > "$test_home/.pi/agent/AGENTS.md"
expect_sync_failure 'installation conflict was activated'
[[ "$(git -C "$runtime" rev-parse HEAD)" == "$before_conflict" ]] || fail 'installation conflict changed the runtime checkout'
HOME="$test_home" "$runtime/scripts/install.sh" --replace >/dev/null
PATH="$fake_bin:$PATH" HOME="$test_home" SLOPESTYLE_TEST_COMMAND_LOG="$command_log" \
  "$runtime/scripts/sync.sh" >/dev/null
[[ "$(git -C "$runtime" rev-parse HEAD)" == "$first_target" ]] || fail 'valid update did not fast-forward'
[[ "$(<"$runtime/sync-test-marker")" == 'first update' ]] || fail 'valid update did not activate fetched content'
grep -q ' success commit=' "$test_home/.local/state/slopestyle/status" || fail 'valid update did not record success'
HOME="$test_home" "$runtime/scripts/check.sh" --installed >/dev/null

cp "$publisher/skills/manifest.json" "$tmp/manifest.json"
printf '%s\n' '{}' > "$publisher/skills/manifest.json"
commit_all "$publisher" 'Break fetched validation'
git -C "$publisher" push -q
before_invalid="$(git -C "$runtime" rev-parse HEAD)"
expect_sync_failure 'invalid fetched main was activated'
[[ "$(git -C "$runtime" rev-parse HEAD)" == "$before_invalid" ]] || fail 'invalid fetched main changed the runtime checkout'
grep -q 'failure phase=validating fetched main' "$test_home/.local/state/slopestyle/status" || fail 'invalid update failure was not recorded'
if find "$test_home/.local/state/slopestyle" -maxdepth 1 -type d -name 'validate.*' | grep -q .; then
  fail 'failed validation leaked its temporary directory'
fi
[[ "$(git -C "$runtime" worktree list --porcelain | grep -c '^worktree ')" == '1' ]] || fail 'failed validation leaked a Git worktree'

cp "$tmp/manifest.json" "$publisher/skills/manifest.json"
commit_all "$publisher" 'Restore fetched validation'
git -C "$publisher" push -q
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null

printf '%s\n' 'local change' >> "$runtime/README.md"
printf '%s\n' 'second update' > "$publisher/sync-test-marker"
commit_all "$publisher" 'Add second update'
git -C "$publisher" push -q
before_dirty="$(git -C "$runtime" rev-parse HEAD)"
expect_sync_failure 'dirty runtime checkout was updated'
[[ "$(git -C "$runtime" rev-parse HEAD)" == "$before_dirty" ]] || fail 'dirty runtime checkout changed commits'
grep -q 'failure phase=checking runtime checkout' "$test_home/.local/state/slopestyle/status" || fail 'dirty checkout failure was not recorded'
git -C "$runtime" checkout -q -- README.md
HOME="$test_home" "$runtime/scripts/sync.sh" >/dev/null

printf '%s\n' 'runtime divergence' > "$runtime/runtime-only"
commit_all "$runtime" 'Create runtime divergence'
printf '%s\n' 'remote divergence' > "$publisher/remote-only"
commit_all "$publisher" 'Create remote divergence'
git -C "$publisher" push -q
before_divergence="$(git -C "$runtime" rev-parse HEAD)"
expect_sync_failure 'divergent runtime checkout was updated'
[[ "$(git -C "$runtime" rev-parse HEAD)" == "$before_divergence" ]] || fail 'divergent runtime checkout changed commits'
grep -q 'failure phase=checking fast-forward' "$test_home/.local/state/slopestyle/status" || fail 'divergence failure was not recorded'

printf 'Sync integration: OK\n'
