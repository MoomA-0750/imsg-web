#!/bin/bash
# Sets imsg-web up on this Mac from a clone of the repository, in one command:
#
#   ./scripts/setup.sh [--no-lan] [--origin https://<host>] [--port 8787] [--send live|dry-run|off]
#
# It fetches Node 24 (checked against nodejs.org's checksums), builds this app, builds imsg with the
# patches in imsg-patches/, and hands all of it to install.sh, which issues a temporary password and
# starts the server. The options are install.sh's. What it downloads and builds stays in .setup/ in this
# checkout, so running it again after `git pull` reuses that and installs only what changed.
set -eu

NODE_VERSION=24.20.0
IMSG_COMMIT=e2f5046
# The order matters: each patch is written against the tree the one before it leaves.
PATCHES="contact-batch/imsg-0.15.1 contact-source/imsg-0.15.4 link-preview/imsg-0.15.4 unread-mark/imsg-0.15.4"

[ "$(uname)" = Darwin ] || { echo "This sets up a Mac, so it only runs on one." >&2; exit 1; }
xcrun --find swift >/dev/null 2>&1 && command -v git >/dev/null || {
  echo "The Xcode Command Line Tools are needed to build imsg. Run  xcode-select --install , then this again." >&2; exit 1; }
case "$(uname -m)" in arm64) arch=arm64 ;; x86_64) arch=x64 ;; *) echo "Unknown Mac architecture: $(uname -m)" >&2; exit 1 ;; esac

project="$(cd -- "$(dirname -- "$0")/.." && pwd)"
work="$project/.setup"
mkdir -p "$work"

# Node: our own copy, never the system's, because this is the binary that gets Full Disk Access.
node="$work/node-v$NODE_VERSION-darwin-$arch"
if [ ! -x "$node/bin/node" ]; then
  echo "fetching Node $NODE_VERSION…"
  tarball="node-v$NODE_VERSION-darwin-$arch.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$tarball" -o "$work/$tarball"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  if ! (cd "$work" && grep " $tarball\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null 2>&1); then
    rm -f "$work/$tarball"
    echo "The Node download does not match nodejs.org's checksum, so it was not unpacked." >&2; exit 1
  fi
  tar -xzf "$work/$tarball" -C "$work"
  rm -f "$work/$tarball" "$work/SHASUMS256.txt"
fi
export PATH="$node/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "building the app…"
(cd "$project" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm run build >/dev/null)

# imsg: upstream at the commit the patches were made for, patched, built. Built again only when the
# commit or a patch changes, from a fresh clone, because a half-patched tree cannot be re-patched.
imsg="$work/imsg"
want="$IMSG_COMMIT $(for p in $PATCHES; do cat "$project/imsg-patches/$p.patch"; done | shasum -a 256 | cut -c1-16)"
if [ "$(cat "$work/imsg.stamp" 2>/dev/null || true)" != "$want" ]; then
  echo "building imsg with the patches (a few minutes the first time)…"
  rm -rf -- "$imsg" "$work/imsg.stamp"
  git clone -q https://github.com/openclaw/imsg.git "$imsg"
  git -C "$imsg" checkout -q "$IMSG_COMMIT"
  for p in $PATCHES; do git -C "$imsg" apply "$project/imsg-patches/$p.patch"; done
  if ! (cd "$imsg" && swift build -c release --product imsg --force-resolved-versions) > "$work/imsg-build.log" 2>&1; then
    tail -20 "$work/imsg-build.log" >&2
    echo "imsg did not build; the whole log is in $work/imsg-build.log" >&2; exit 1
  fi
  echo "$want" > "$work/imsg.stamp"
fi
bin="$(cd "$imsg" && swift build -c release --show-bin-path)"

exec "$project/scripts/install.sh" --imsg "$bin/imsg" --node "$node" "$@"
