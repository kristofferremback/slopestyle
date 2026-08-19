#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
stable_root="$HOME/.local/share/slopestyle"
state_root="$HOME/.local/state/slopestyle"
fetch_failure_file="$state_root/fetch-failures"
phase="starting"
validation_parent=""

mkdir -p "$state_root"
if [[ -z "${SLOPESTYLE_SYNC_LOCK_FD:-}" ]]; then
  command -v python3 >/dev/null || {
    printf 'python3 is required to synchronize Slop(e)style.\n' >&2
    exit 1
  }
  exec python3 - "$state_root/sync.lock" "$0" "$@" <<'PY'
import fcntl
import os
import sys

lock_path = sys.argv[1]
command = sys.argv[2:]
lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print("Another Slop(e)style sync is already running.", file=sys.stderr)
    raise SystemExit(75)
os.set_inheritable(lock_fd, True)
environment = os.environ.copy()
environment["SLOPESTYLE_SYNC_LOCK_FD"] = str(lock_fd)
os.execvpe(command[0], command, environment)
PY
fi

if (($#)); then
  if [[ "$1" == "-h" || "$1" == "--help" ]] && (($# == 1)); then
    printf 'Usage: %s\n' "$0"
    exit 0
  fi
  printf 'Usage: %s\n' "$0" >&2
  exit 2
fi

notify_failure() {
  local message="Slop(e)style sync failed during $phase. See $state_root/sync.log"
  case "$(uname -s)" in
    Darwin)
      if command -v osascript >/dev/null 2>&1; then
        osascript - "$message" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run arguments
  display notification (item 1 of arguments) with title "Slop(e)style"
end run
APPLESCRIPT
      fi
      ;;
    Linux)
      if command -v notify-send >/dev/null 2>&1; then
        notify-send 'Slop(e)style' "$message" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e

  if [[ -n "$validation_parent" && -d "$validation_parent/repo" ]]; then
    git -C "$repo_root" worktree remove --force "$validation_parent/repo" >/dev/null 2>&1 || true
  fi
  if [[ -n "$validation_parent" && -d "$validation_parent" ]]; then
    rmdir "$validation_parent" >/dev/null 2>&1 || true
  fi
  if ((rc == 0)); then
    rm -f "$fetch_failure_file"
    printf '%s success commit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C "$repo_root" rev-parse HEAD)" > "$state_root/status"
  else
    printf '%s failure phase=%s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$phase" "$rc" > "$state_root/status"
    if [[ "$phase" == "fetching origin/main" ]]; then
      fetch_failures=0
      if [[ -f "$fetch_failure_file" ]]; then
        fetch_failures="$(<"$fetch_failure_file")"
      fi
      [[ "$fetch_failures" =~ ^[0-9]+$ ]] || fetch_failures=0
      fetch_failures=$((fetch_failures + 1))
      printf '%s\n' "$fetch_failures" > "$fetch_failure_file"
      if ((fetch_failures == 4)); then
        notify_failure
      fi
    else
      rm -f "$fetch_failure_file"
      notify_failure
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log_file="$state_root/sync.log"
if [[ -f "$log_file" ]] && (( $(wc -c < "$log_file") > 1048576 )); then
  mv -f "$log_file" "$state_root/sync.previous.log"
fi
if [[ "${SLOPESTYLE_LAUNCHD:-}" == "1" ]]; then
  exec >> "$log_file" 2>&1
else
  exec > >(tee -a "$log_file") 2>&1
fi

phase="checking runtime checkout"
if [[ ! -d "$stable_root/.git" ]] || [[ "$(cd "$stable_root" && pwd -P)" != "$repo_root" ]]; then
  printf 'Sync must run from the stable runtime checkout at %s.\n' "$stable_root" >&2
  exit 1
fi
if [[ "$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null)" != "$repo_root" ]]; then
  printf 'Sync must run from the root of its Slop(e)style checkout.\n' >&2
  exit 1
fi
if [[ "$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null || true)" != "main" ]]; then
  printf 'Runtime checkout must be on main: %s\n' "$repo_root" >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
  printf 'Runtime checkout is dirty; refusing to update: %s\n' "$repo_root" >&2
  exit 1
fi
if ! git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
  printf 'Runtime checkout has no origin remote: %s\n' "$repo_root" >&2
  exit 1
fi

phase="fetching origin/main"
git -C "$repo_root" fetch --prune origin main
if ! git -C "$repo_root" show-ref --verify --quiet refs/remotes/origin/main; then
  printf 'origin/main is unavailable after fetch.\n' >&2
  exit 1
fi

current="$(git -C "$repo_root" rev-parse HEAD)"
target="$(git -C "$repo_root" rev-parse origin/main)"

if [[ "$current" != "$target" ]]; then
  phase="checking fast-forward"
  if ! git -C "$repo_root" merge-base --is-ancestor "$current" "$target"; then
    printf 'Runtime checkout has diverged from origin/main; refusing to update.\n' >&2
    exit 1
  fi

  phase="validating fetched main"
  validation_parent="$(mktemp -d "$state_root/validate.XXXXXX")"
  git -C "$repo_root" worktree add --detach "$validation_parent/repo" "$target" >/dev/null
  "$validation_parent/repo/scripts/check.sh"
  "$validation_parent/repo/scripts/install.sh" --preflight-for "$repo_root"
  git -C "$repo_root" worktree remove --force "$validation_parent/repo" >/dev/null
  rmdir "$validation_parent"
  validation_parent=""

  phase="fast-forwarding runtime checkout"
  git -C "$repo_root" merge --ff-only "$target"

  phase="installing fetched main"
  "$repo_root/scripts/install.sh"
else
  phase="checking installed state"
  if "$repo_root/scripts/check.sh" --installed; then
    printf 'Slop(e)style is already current at %s.\n' "$current"
    exit 0
  fi

  printf 'Installed state needs repair; rerunning the installer.\n'
  phase="repairing installed state"
  "$repo_root/scripts/install.sh"
fi

phase="checking installed state"
"$repo_root/scripts/check.sh" --installed
printf 'Slop(e)style synced to %s. Start fresh agent sessions to load it.\n' "$(git -C "$repo_root" rev-parse HEAD)"
