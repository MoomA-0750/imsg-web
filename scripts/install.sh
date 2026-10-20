#!/bin/bash
# Installs a built checkout as a running LaunchAgent, from one command.
#
#   ./scripts/install.sh --imsg <path> --node <dir> [--origin https://<host>] [--port 8787]
#                        [--lan-port 8788 | --no-lan] [--send live]
#
# It serves http://localhost:<port> for the Mac itself, and https://<this Mac>.local:<lan-port> for
# phones and computers on the same network, with a certificate it makes here. That certificate is
# self-signed, so each device shows a warning the first time; --no-lan keeps it to the Mac alone.
# Give --origin https://<address> when something in front of the loopback port — Tailscale Serve, a
# reverse proxy — carries TLS of its own.
#
# --no-start writes everything and stops short of loading the agent, for looking before starting.
#
# What it does, and nothing else: lays out the private directory this app owns, copies the build
# into a release named after the commit, writes the LaunchAgent, starts it, and asks for a password.
# Run it again after `npm run build` to install a new release; the old one stays as the way back.
#
# What it does not do, because none of it can be done for you: build `imsg` with the patches (see
# imsg-patches/README.md), grant Full Disk Access to the Node binary it installs, or put the port on
# your tailnet (see docs/operations.md). It will tell you which of those are still outstanding.
set -eu

[ "$(uname)" = Darwin ] || { echo "This installs a macOS LaunchAgent, so it only runs on a Mac." >&2; exit 1; }
[ "$(id -u)" != 0 ] || { echo "Run this as yourself, not as root: the agent belongs to your login session." >&2; exit 1; }

base="$HOME/Library/Application Support/imsg-web"
label="local.imsg-web"
port=8787
send="live"
start="yes"
imsg=""
node=""
origin=""
lanport=8788
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --imsg) imsg="$2"; shift 2 ;;
    --node) node="$2"; shift 2 ;;
    --origin) origin="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --send) send="$2"; shift 2 ;;
    --lan-port) lanport="$2"; shift 2 ;;
    --no-lan) lanport=""; shift ;;
    --label) label="$2"; shift 2 ;;
    --no-start) start="no"; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

project="$(cd -- "$(dirname -- "$0")/.." && pwd)"
[ -f "$project/dist/main.js" ] || { echo "No build found. Run: npm ci --ignore-scripts && npm run build" >&2; exit 1; }
[ -n "$imsg" ] && [ -x "$imsg" ] || { echo "--imsg must point at a patched imsg binary (see imsg-patches/README.md)." >&2; exit 1; }
[ -n "$node" ] || { echo "--node must point at an unpacked Node 24 distribution, or its bin/node." >&2; exit 1; }
# Loopback for the Mac itself: nothing to configure, nothing to install.
[ -n "$origin" ] || origin="http://localhost:$port"
# The local network under the Mac's Bonjour name, which is what phones on the same Wi-Fi resolve.
lanorigin=""
if [ -n "$lanport" ]; then
  lanhost="$(scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  case "$lanhost" in
    ""|*[!a-z0-9-]*) echo "This Mac has no usable local hostname (System Settings → General → Sharing → Local hostname). Set one, or install with --no-lan." >&2; exit 1 ;;
  esac
  lanorigin="https://$lanhost.local:$lanport"
fi

# --node may name the binary or the distribution it lives in; a whole distribution is what gets copied.
case "$node" in */bin/node) node="$(cd -- "$(dirname -- "$node")/.." && pwd)" ;; esac
[ -x "$node/bin/node" ] || { echo "No bin/node under $node." >&2; exit 1; }
version="$("$node/bin/node" --version)"
case "$version" in v24.*) ;; *) echo "Node $version is not what this was built against (v24)." >&2; exit 1 ;; esac

release="$(cd "$project" && git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
target="$base/releases/$release"

# 0700 throughout: this holds a password hash, session state and whatever an attachment is mid-send.
umask 077
mkdir -p "$base/releases" "$base/state" "$base/logs" "$base/runtime"
chmod 700 "$base" "$base/releases" "$base/state" "$base/logs" "$base/runtime"

runtime="$base/runtime/$(basename "$node")"
if [ ! -x "$runtime/bin/node" ]; then
  echo "installing the Node runtime…"
  rm -rf -- "$runtime"
  cp -R "$node" "$runtime"
fi

echo "installing release $release…"
rm -rf -- "$target"
mkdir -p "$target"
cp -R "$project/dist" "$target/dist"
cp "$project/package.json" "$project/package-lock.json" "$target/"
cp -R "$project/scripts" "$target/scripts"
# Production dependencies only where npm is to hand; otherwise what the checkout already has, which
# is the same tree with the build and test tools left in.
if command -v npm >/dev/null 2>&1; then
  (cd "$target" && npm ci --omit=dev --ignore-scripts >/dev/null)
else
  cp -R "$project/node_modules" "$target/node_modules"
fi

# imsg and the resource bundles beside it: without those it crashes on the first request.
cp "$imsg" "$target/imsg"
for bundle in "$(dirname "$imsg")"/*.bundle; do [ -e "$bundle" ] && cp -R "$bundle" "$target/"; done
chmod -R go-rwx "$target"
install -m 700 "$project/scripts/imsg-web.sh" "$base/imsg-web"

# A certificate for the LAN address, made here and kept in the state directory beside the password
# hash. Made again when the Mac's name is not in it — a renamed Mac — and otherwise kept, so a phone
# that has already accepted it is not asked again after every install.
if [ -n "$lanorigin" ]; then
  tls="$base/state/tls"
  mkdir -p "$tls"; chmod 700 "$tls"
  if ! openssl x509 -in "$tls/cert.pem" -noout -text 2>/dev/null | grep -q "DNS:$lanhost.local"; then
    echo "making a certificate for $lanhost.local…"
    san="DNS:$lanhost.local"
    for ip in $(ifconfig | awk '$1 == "inet" && $2 != "127.0.0.1" { print $2 }'); do san="$san,IP:$ip"; done
    openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
      -keyout "$tls/key.pem.new" -out "$tls/cert.pem.new" \
      -config <(printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=%s.local\n[ext]\nsubjectAltName=%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$lanhost" "$san") 2>/dev/null
    chmod 600 "$tls/key.pem.new" "$tls/cert.pem.new"
    mv "$tls/key.pem.new" "$tls/key.pem"; mv "$tls/cert.pem.new" "$tls/cert.pem"
  fi
fi

# The agent cannot be written before there is a password to let anyone in: the generator checks that
# the credential file exists and is the owner's alone. So this is asked for here, once, and the
# install continues into a server that is already closed to everyone else.
if [ ! -f "$base/state/owner.json" ]; then
  if [ -t 0 ]; then
    echo
    "$base/imsg-web" auth set-password
  else
    echo "No password is set yet, and the agent cannot be written without one. Run:" >&2
    echo "  \"$base/imsg-web\" auth set-password" >&2
    echo "then run this again." >&2
    exit 1
  fi
fi

plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents"
[ "$start" = yes ] && launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
# Set aside under the release it was pointing at, so pruning that release takes this with it.
if [ -f "$plist" ]; then
  was=$(grep -o 'releases/[0-9a-zA-Z_-]*' "$plist" | sed 's|releases/||' | sort -u | head -1)
  mv "$plist" "$base/$label.plist.${was:-previous}"
fi

env -i HOME="$HOME" PATH=/usr/bin:/bin "$runtime/bin/node" "$target/scripts/generate-launch-agent.mjs" \
  --base "$base" --release "$target" --imsg "$target/imsg" \
  --origin "$origin" --port "$port" --label "$label" --stateName state --output "$plist" \
  --send "$send" ${lanorigin:+--lanOrigin "$lanorigin"}
if [ "$start" = yes ]; then
  launchctl bootstrap "gui/$(id -u)" "$plist"
  "$base/imsg-web" prune >/dev/null 2>&1 || true
else
  echo "not started: the agent is written but not loaded (--no-start)."
fi

echo
echo "installed:  $release"
case "$origin" in
  http://localhost*|http://127.0.0.1*|http://\[::1\]*) echo "on the Mac: $origin" ;;
  *) echo "reachable:  $origin (once the port is served there)" ;;
esac
if [ -n "$lanorigin" ]; then
  echo "on the LAN: $lanorigin"
  echo "            the first visit from each device warns that the certificate is not trusted;"
  echo "            it is this one, made on this Mac — check it matches, then go on:"
  echo "            $(openssl x509 -in "$tls/cert.pem" -noout -fingerprint -sha256 | sed 's/^.*=//')"
fi
echo "sending:    $send"
echo "logs:       $base/logs/$label.{out,err}.log"
echo
echo "Still yours to do, if you have not already:"
echo "  • Full Disk Access for $runtime/bin/node (System Settings → Privacy & Security)"
if [ -n "$lanorigin" ] && /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | grep -q enabled; then
  echo "  • The macOS firewall is on: allow incoming connections for $runtime/bin/node when asked"
fi
case "$origin" in
  http://localhost*|http://127.0.0.1*|http://\[::1\]*)
    echo
    echo "To open it from outside your network as well, put something in front of port $port that"
    echo "carries TLS — Tailscale Serve is the easy one — and install again with --origin https://<that address>." ;;
  *) echo "  • Make $origin reach port $port on this Mac (e.g. tailscale serve --bg $port)" ;;
esac
