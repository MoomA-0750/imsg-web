#!/bin/bash
# imsg-web administration, installed at <base>/imsg-web so the command stays the same whatever
# release is running. Run it on the Mac itself: the app refuses an SSH environment.
#
#   <base>/imsg-web auth rotate         replaces the secret with a generated key, and prints it
#   <base>/imsg-web auth set-password   asks for a password without echoing it
#   <base>/imsg-web auth revoke-all     signs every session out
#   <base>/imsg-web auth status
#   <base>/imsg-web prune [--dry-run]    removes releases older than the running one and its rollback
set -eu

base="$(cd -- "$(dirname -- "$0")" && pwd)"
[ -d "$base/releases" ] && [ -d "$base/state" ] || { echo "Not an imsg-web base directory: $base" >&2; exit 1; }

entry="$base/releases/$(ls -t "$base/releases" | head -1)/dist/main.js"
[ -f "$entry" ] || { echo "No usable release under $base/releases." >&2; exit 1; }

# Old releases are 27 MB each and accumulate one per handover. Kept: the one the agent is actually
# running, and the newest of the rest as the step back. The running release is read from the agent
# itself rather than guessed, and nothing is removed if that cannot be established.
if [ "${1-}" = "prune" ]; then
  dry=""
  [ "${2-}" = "--dry-run" ] && dry="yes"
  plist="$HOME/Library/LaunchAgents/local.imsg-web.readonly.plist"
  running=$(grep -o 'releases/[0-9a-zA-Z_-]*' "$plist" 2>/dev/null | sed 's|releases/||' | sort -u | head -1 || true)
  [ -n "$running" ] || { echo "Cannot tell which release is running; nothing removed." >&2; exit 1; }
  [ -d "$base/releases/$running" ] || { echo "The running release is not under releases/; nothing removed." >&2; exit 1; }
  rollback=$(ls -t "$base/releases" | grep -v "^$running\$" | head -1 || true)
  echo "keeping: $running (running)${rollback:+, $rollback (rollback)}"
  for release in $(ls -t "$base/releases"); do
    [ "$release" = "$running" ] && continue
    [ "$release" = "$rollback" ] && continue
    if [ -n "$dry" ]; then
      echo "would remove: $release"
    else
      rm -rf -- "$base/releases/$release" "$base/local.imsg-web.readonly.plist.$release"
      echo "removed: $release"
    fi
  done
  exit 0
fi

node=""
for candidate in "$base"/runtime/*/bin/node; do [ -x "$candidate" ] && node="$candidate"; done
[ -n "$node" ] || { echo "No Node runtime under $base/runtime." >&2; exit 1; }

run() { env -i HOME="$HOME" PATH=/usr/bin:/bin IMSG_WEB_STATE_DIR="$base/state" "$node" "$entry" "$@"; }

# A password is never an argument: `ps` would show it to every process on the Mac. Asked for here
# and handed over on stdin, it reaches neither the process list nor the shell's history.
if [ "${1-}" = "auth" ] && [ "${2-}" = "set-password" ] && [ -t 0 ]; then
  printf '新しいパスワード（8文字以上・英字と数字を各1文字以上）: ' >&2
  trap 'stty echo 2>/dev/null; printf "\n" >&2' EXIT
  stty -echo
  IFS= read -r password
  stty echo
  trap - EXIT
  printf '\n' >&2
  printf '%s' "$password" | run "$@"
  exit $?
fi

exec env -i HOME="$HOME" PATH=/usr/bin:/bin IMSG_WEB_STATE_DIR="$base/state" "$node" "$entry" "$@"
