# Operations

How the read-only web UI runs on a Mac. One instance per Mac, operated in the
Messages owner's GUI session.

## Path and boundary

```
Browser -> Tailscale Serve HTTPS :443 -> http://127.0.0.1:8787 -> imsg rpc (read-only)
```

- The app binds loopback only. Never bind it to LAN or all interfaces, and never
  enable Funnel.
- Tailscale gets you to the login page; the owner's secret is what gets you in.
  Do not use Tailscale identity headers as authentication.
- Host/Origin must be exactly `https://<host-fqdn>`.
- HTTPS certificate issuance publishes the FQDN in Certificate Transparency
  logs.
- Only `status`, `chats.list`, `messages.history`, `watch.subscribe` and
  `watch.unsubscribe` can reach imsg. No web route changes anything.

## Files

```
~/Library/Application Support/imsg-web/   (0700)
  runtime/node-v24.20.0-<arch>/           official Node, checksum verified
  releases/<commit>/                      dist, package files, node_modules,
                                          imsg + its two .bundle directories
  state/                                  owner credential (0600), lock
  logs/                                   stdout / stderr (0600)
  imsg-web                                administration wrapper (0700)
```

Do not run production from the repository or a temp directory, and do not use a
`current` symlink. `imsg` is the patched build from `imsg-patches/`.

## Permissions

Full Disk Access for the dedicated Node binary only, granted by the owner in
System Settings. That covers both `chat.db` and the AddressBook store. No
Contacts grant is needed. Never edit TCC databases or change SIP. SSH working
does not prove the LaunchAgent works: under launchd the responsible process is
the Node.

## LaunchAgent

Generate the plist; it never installs or starts anything:

```sh
<node> scripts/generate-launch-agent.mjs --base <base> --release <release> \
  --imsg <release>/imsg --origin https://<host-fqdn> --port 8787 \
  --label local.imsg-web.readonly --stateName state --output <new-plist>
```

The owner places it at `~/Library/LaunchAgents/local.imsg-web.readonly.plist`
and loads it with `launchctl bootstrap gui/$(id -u) <plist>`. It starts at login
and is not restarted automatically after a crash.

## Signing in

Two kinds of secret get the owner in, and only one is active at a time.

- **A generated key** — 43 random characters, 256 bits. `setup` mints the first
  one and `auth rotate` replaces it. Nothing can guess it, so the file holds a
  plain SHA-256 of it.
- **A password the owner chooses** — set with `auth set-password`, which reads it
  from stdin so it never appears in argv where `ps` would show it to every
  process. It must be at least 8 characters with a letter and a digit. Because a
  chosen password *is* guessable, the file holds a salted scrypt derivation
  (N=2^16, ~150 ms per attempt) rather than a bare hash.

`scripts/imsg-web.sh` is installed at `<base>/imsg-web` (0700) as part of a deploy, so the
administration commands stay the same however many releases come and go: it picks the newest
release and the runtime beside it, and supplies the state directory.

```sh
"$HOME/Library/Application Support/imsg-web/imsg-web" auth set-password   # asks, without echo
"$HOME/Library/Application Support/imsg-web/imsg-web" auth rotate         # prints a new key
"$HOME/Library/Application Support/imsg-web/imsg-web" auth revoke-all
"$HOME/Library/Application Support/imsg-web/imsg-web" auth status
```

The sign-in screen carries `auth rotate` behind a "パスワードを忘れた場合" link, so being locked
out does not mean going looking for this file.

Either way the secret never goes into chat, logs, argv, environment or this
repository, and setting one signs every session out. A password is weaker than a
generated key by a wide margin — 8 characters with a letter and a digit is about
36^8 — so it rests on three things: the login limit of 20 attempts a minute, the
scrypt cost if `owner.json` is ever stolen, and the app being reachable only
from the tailnet. Losing the password is recoverable: `auth rotate` puts a fresh
generated key in its place.

`owner.json` still reads both forms, so a release can be deployed before a
password is chosen without locking the owner out.

## Sending (optional, off by default)

Sending is a separate path and is off unless the plist carries `IMSG_WEB_SEND`.
Add `--send dry-run` (validate and resolve a target, dispatch nothing) or
`--send live` to the generator command:

```sh
<node> scripts/generate-launch-agent.mjs ... --send dry-run
```

`live` needs, on this Mac, done by the owner:

- Messages.app running and signed in to iMessage.
- An Automation grant so the app's dedicated Node may control Messages (macOS
  prompts on the first send; approve it in System Settings → Privacy & Security
  → Automation). No SIP change, and no IMCore injection: sending uses the
  AppleScript transport (text and/or one attachment).

Start `live` with a single message to your own number, and confirm it arrives.
Sending never reuses the read path; the read RPC allowlist is unchanged.

Attachments: the browser uploads the file to `POST /api/uploads` (binary,
streamed to `<state>/child-tmp/uploads`, at most 100 MiB, dropped after ten
minutes if unsent) and the send passes its path to imsg. imsg then copies it
into `~/Library/Messages/Attachments/imsg/<uuid>/` for Messages, and those
copies accumulate there — clear them out occasionally if they add up.

## Serve

With the owner's approval at the time, and after checking `tailscale serve
status` shows nothing unexpected:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8787
```

## Stop

1. Turn off only this Serve route.
2. `launchctl bootout gui/$(id -u)/local.imsg-web.readonly`
3. Check the app and its imsg child are gone and port 8787 is closed.

If it does not stop cleanly or a lock remains, leave the lock where it is and
ask the owner. Never delete lock or socket files automatically, and never
`killall imsg`: the iMac runs another system's imsg.

## Update

Put the new build in a new `releases/<commit>/`, stop, point the plist at it,
start, log in and check. To roll back, point the plist at the previous release.
The owner hash in `state/` is never rolled back.

## During the trial

The owner uses it normally. Occasionally check memory for the app and its child
(`ps -o rss= -p <pid>`) and that the logs stay small and free of message
content.

## When a send does not go

A send that fails before it reaches Messages leaves nothing behind: no message in
chat.db, no entry in the system log, nothing in Messages itself. So the server
writes one line about it, and only about it, to its error log:

```sh
tail -n 20 "$HOME/Library/Application Support/imsg-web/logs/local.imsg-web.readonly.err.log"
```

Each line says what shape the failure had — whether there was an attachment, how
far imsg got (`disposition`), whether it is safe to retry, the AppleScript error
number Messages returned, or, for a child that died before answering, its own
first line with paths, addresses and numbers already removed. No message text, no
recipient and no identifier is ever written. A send that works writes nothing.

If a send never reached imsg at all, the line begins `refused`, and names only the
route and the status.
