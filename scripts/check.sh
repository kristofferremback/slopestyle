#!/bin/sh
set -eu
BUN=$(command -v bun 2>/dev/null || :)
if [ -z "$BUN" ]; then
  for candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then BUN=$candidate; break; fi
  done
fi
[ -n "$BUN" ] || { echo 'Bun is required to run Slop(e)style.' >&2; exit 1; }
name=${0##*/}
exec "$BUN" "$(dirname "$0")/${name%.sh}.ts" "$@"
