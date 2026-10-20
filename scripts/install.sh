#!/bin/bash
# Installs a built checkout as a running LaunchAgent. scripts/setup.sh builds everything and calls
# this; run it directly only with an imsg and a Node of your own:
#
#   ./scripts/install.sh --imsg <path> --node <dir> [--port 8787] [--no-lan]
#                        [--origin https://<host>] [--send live|dry-run|off] [--no-start]
#
# It copies the build into a release of its own under ~/Library/Application Support/imsg-web, makes
# a self-signed certificate and a temporary password the first time, and starts the
# server on https://<this Mac>.local:<port> (https://localhost with --no-lan). --origin names an
# address that something in front of it — Tailscale Serve — serves. The previous release stays as
# the way back. --no-start writes everything but does not start it.
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
lan="yes"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --imsg) imsg="$2"; shift 2 ;;
    --node) node="$2"; shift 2 ;;
    --origin) origin="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --send) send="$2"; shift 2 ;;
    --no-lan) lan="no"; shift ;;
    --label) label="$2"; shift 2 ;;
    --no-start) start="no"; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

project="$(cd -- "$(dirname -- "$0")/.." && pwd)"
[ -f "$project/dist/main.js" ] || { echo "No build found. Run ./scripts/setup.sh, which builds everything and then installs." >&2; exit 1; }
[ -n "$imsg" ] && [ -x "$imsg" ] || { echo "--imsg must point at a patched imsg binary (see imsg-patches/README.md)." >&2; exit 1; }
[ -n "$node" ] || { echo "--node must point at an unpacked Node 24 distribution, or its bin/node." >&2; exit 1; }
# The Mac's Bonjour name, which is what phones on the same Wi-Fi resolve, and the address it serves.
lanhost="$(scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]')"
case "$lanhost" in ""|*[!a-z0-9-]*) lanhost="" ;; esac
lanorigin=""
if [ "$lan" = yes ]; then
  [ -n "$lanhost" ] || { echo "This Mac has no usable local hostname (System Settings → General → Sharing → Local hostname). Set one, or install with --no-lan." >&2; exit 1; }
  lanorigin="https://$lanhost.local:$port"
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

# The server's certificate, made here and kept in the state directory beside the password hash.
# Made again when the Mac's name or localhost is not in it — a renamed Mac, or one made by an older
# install — and otherwise kept, so a phone that has accepted it is not asked again every install.
tls="$base/state/tls"
mkdir -p "$tls"; chmod 700 "$tls"
names="DNS:localhost${lanhost:+,DNS:$lanhost.local}"
current="$(openssl x509 -in "$tls/cert.pem" -noout -text 2>/dev/null || true)"
if ! { echo "$current" | grep -q "DNS:localhost" && { [ -z "$lanhost" ] || echo "$current" | grep -q "DNS:$lanhost.local"; }; }; then
  echo "making a certificate for ${lanhost:+$lanhost.local and }localhost…"
  san="$names,IP:127.0.0.1"; cn="localhost"; [ -z "$lanhost" ] || cn="$lanhost.local"
  for ip in $(ifconfig | awk '$1 == "inet" && $2 != "127.0.0.1" { print $2 }'); do san="$san,IP:$ip"; done
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
    -keyout "$tls/key.pem.new" -out "$tls/cert.pem.new" \
    -config <(printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=%s\n[ext]\nsubjectAltName=%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$cn" "$san") 2>/dev/null
  chmod 600 "$tls/key.pem.new" "$tls/cert.pem.new"
  mv "$tls/key.pem.new" "$tls/key.pem"; mv "$tls/cert.pem.new" "$tls/cert.pem"
fi

# The agent cannot be written before there is a credential to let the owner in: the generator checks
# that the file exists and is the owner's alone. The first one is a temporary password, shown once at
# the end; signing in with it asks for a password of the owner's own.
temporary=""
if [ ! -f "$base/state/owner.json" ]; then
  temporary="$("$base/imsg-web" auth temporary)"
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
  --port "$port" --label "$label" --stateName state --output "$plist" \
  --send "$send" ${origin:+--origin "$origin"} ${lanorigin:+--lanOrigin "$lanorigin"}
if [ "$start" = yes ]; then
  launchctl bootstrap "gui/$(id -u)" "$plist"
  "$base/imsg-web" prune >/dev/null 2>&1 || true
else
  echo "not started: the agent is written but not loaded (--no-start)."
fi

# The addresses to open: the Mac's name, and its addresses for devices that do not resolve `.local`.
echo
echo "installed: $release (sending: $send)"
echo
echo "Open:"
echo "  ${lanorigin:-https://localhost:$port}"
if [ -n "$lanorigin" ]; then
  for ip in $(ifconfig | awk '$1 == "inet" && $2 != "127.0.0.1" { print $2 }'); do
    case "$ip" in 100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) where=" (Tailscale)" ;; *) where="" ;; esac
    echo "  https://$ip:$port$where"
  done
fi
[ -z "$origin" ] || echo "  $origin (once it is served there)"
echo "Each device warns once that the certificate is not trusted. It is this one if it shows"
echo "  $(openssl x509 -in "$tls/cert.pem" -noout -fingerprint -sha256 | sed 's/^.*=//')"
if [ -n "$temporary" ]; then
  echo
  echo "Temporary password: $temporary"
  echo "  Sign in with it once; you will be asked to choose your own."
fi
echo
echo "If you have not yet:"
echo "  • Give Full Disk Access to $runtime/bin/node"
echo "    (System Settings → Privacy & Security → Full Disk Access → +; ⌘⇧G pastes the path),"
echo "    then restart it:  launchctl kickstart -k gui/$(id -u)/$label"
if [ -n "$lanorigin" ] && /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | grep -q enabled; then
  echo "  • Allow incoming connections for that node when the firewall asks"
fi
[ -z "$origin" ] || echo "  • Point $origin at it:  tailscale serve --bg https+insecure://127.0.0.1:$port"
