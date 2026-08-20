#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
stable_root="$HOME/.local/share/slopestyle"
state_root="$HOME/.local/state/slopestyle"
action="${1:-}"
label="dev.slopestyle.sync"

usage() {
  printf 'Usage: %s install|status|uninstall\n' "$0"
}

if [[ "$action" != "install" && "$action" != "status" && "$action" != "uninstall" ]] || (($# != 1)); then
  usage >&2
  exit 2
fi

platform="$(uname -s)"
if [[ "$platform" != "Linux" && "$platform" != "Darwin" ]]; then
  printf 'Unsupported scheduler platform: %s\n' "$platform" >&2
  exit 1
fi

if [[ "$action" == "install" ]]; then
  for required_command in git python3 tee; do
    command -v "$required_command" >/dev/null || {
      printf '%s is required for scheduled synchronization.\n' "$required_command" >&2
      exit 1
    }
  done
  if [[ ! -d "$stable_root/.git" ]]; then
    printf 'Clone the runtime checkout at %s before installing its scheduler.\n' "$stable_root" >&2
    exit 1
  fi
  if [[ "$(cd -P "$stable_root" && pwd -P)" != "$repo_root" ]]; then
    printf 'Install the scheduler from the stable runtime checkout, not a development checkout.\nExpected: %s\nActual:   %s\n' "$stable_root" "$repo_root" >&2
    exit 1
  fi
  if [[ "$(git -C "$stable_root" symbolic-ref --quiet --short HEAD 2>/dev/null || true)" != "main" ]]; then
    printf 'Stable runtime checkout must be on main.\n' >&2
    exit 1
  fi
fi

mkdir -p "$state_root"

case "$platform" in
  Linux)
    command -v systemctl >/dev/null || {
      printf 'systemctl is required to manage the Linux user timer.\n' >&2
      exit 1
    }
    unit_root="$HOME/.config/systemd/user"
    service="$unit_root/slopestyle-sync.service"
    timer="$unit_root/slopestyle-sync.timer"

    case "$action" in
      install)
        mkdir -p "$unit_root"
        escaped_path="${PATH//\\/\\\\}"
        escaped_path="${escaped_path//\"/\\\"}"
        cat > "$service" <<EOF
[Unit]
Description=Synchronize Slop(e)style agent guidance

[Service]
Type=oneshot
WorkingDirectory=$stable_root
ExecStart=$stable_root/scripts/sync.sh
Environment="PATH=$escaped_path"
StandardOutput=journal
StandardError=journal
EOF
        cat > "$timer" <<'EOF'
[Unit]
Description=Periodically synchronize Slop(e)style agent guidance

[Timer]
OnBootSec=2m
OnUnitActiveSec=30m
RandomizedDelaySec=5m
Unit=slopestyle-sync.service

[Install]
WantedBy=timers.target
EOF
        systemctl --user daemon-reload
        systemctl --user enable --now slopestyle-sync.timer
        systemctl --user start slopestyle-sync.service
        printf 'Installed Linux user timer: %s\n' "$timer"
        ;;
      status)
        if [[ -f "$state_root/status" ]]; then
          printf 'Last sync: %s\n' "$(<"$state_root/status")"
        else
          printf 'Last sync: no status recorded\n'
        fi
        systemctl --user status slopestyle-sync.timer --no-pager
        systemctl --user show slopestyle-sync.service --property=Result --property=ExecMainStatus --no-pager
        ;;
      uninstall)
        systemctl --user disable --now slopestyle-sync.timer >/dev/null 2>&1 || true
        rm -f "$service" "$timer"
        systemctl --user daemon-reload
        printf 'Removed Linux Slop(e)style user timer.\n'
        ;;
    esac
    ;;
  Darwin)
    command -v launchctl >/dev/null || {
      printf 'launchctl is required to manage the macOS LaunchAgent.\n' >&2
      exit 1
    }
    agent_root="$HOME/Library/LaunchAgents"
    plist="$agent_root/$label.plist"
    domain="gui/$(id -u)"

    case "$action" in
      install)
        mkdir -p "$agent_root"
        python3 - "$plist" "$label" "$stable_root" "$PATH" "$state_root/sync.log" <<'PY'
import plistlib
import sys
from pathlib import Path

path, label, root, environment_path, log_path = sys.argv[1:]
data = {
    "Label": label,
    "ProgramArguments": [str(Path(root) / "scripts" / "sync.sh")],
    "WorkingDirectory": root,
    "RunAtLoad": True,
    "StartInterval": 1800,
    "EnvironmentVariables": {
        "PATH": environment_path,
        "SLOPESTYLE_LAUNCHD": "1",
    },
    "StandardOutPath": log_path,
    "StandardErrorPath": log_path,
}
with open(path, "wb") as file:
    plistlib.dump(data, file, sort_keys=False)
PY
        if launchctl print "$domain/$label" >/dev/null 2>&1; then
          launchctl bootout "$domain/$label"
          for _ in 1 2 3 4 5 6 7 8 9 10; do
            if ! launchctl print "$domain/$label" >/dev/null 2>&1; then
              break
            fi
            sleep 0.2
          done
          if launchctl print "$domain/$label" >/dev/null 2>&1; then
            printf 'macOS LaunchAgent did not finish unloading: %s\n' "$label" >&2
            exit 1
          fi
        fi
        bootstrapped=0
        for _ in 1 2 3; do
          if launchctl bootstrap "$domain" "$plist"; then
            bootstrapped=1
            break
          fi
          sleep 1
        done
        if ((bootstrapped == 0)); then
          printf 'Could not load macOS LaunchAgent after three attempts: %s\n' "$plist" >&2
          exit 1
        fi
        printf 'Installed macOS LaunchAgent: %s\n' "$plist"
        ;;
      status)
        if [[ -f "$state_root/status" ]]; then
          printf 'Last sync: %s\n' "$(<"$state_root/status")"
        else
          printf 'Last sync: no status recorded\n'
        fi
        launchctl print "$domain/$label"
        ;;
      uninstall)
        if launchctl print "$domain/$label" >/dev/null 2>&1; then
          launchctl bootout "$domain/$label"
        fi
        rm -f "$plist"
        printf 'Removed macOS Slop(e)style LaunchAgent.\n'
        ;;
    esac
    ;;
esac
