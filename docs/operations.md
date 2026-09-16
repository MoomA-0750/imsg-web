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
  --label local.imsg-web --stateName state --output <new-plist>
```

The owner places it at `~/Library/LaunchAgents/local.imsg-web.plist`
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
"$HOME/Library/Application Support/imsg-web/imsg-web" prune --dry-run     # says what it would remove
"$HOME/Library/Application Support/imsg-web/imsg-web" prune               # and removes it
```

`prune` is the last step of a deploy. A release is about 27 MB and one arrives per handover, so
without it they pile up: it keeps the release the LaunchAgent is actually running — read from the
agent, not guessed — and the newest of the rest as the step back, and removes the others along
with the plists set aside for them. It never touches the runtime, the state directory or logs, and
it refuses to remove anything at all if it cannot establish what is running.

This used to be a script in `/tmp`, which macOS eventually cleared; the last line of several
handovers quietly did nothing. That is why it lives in the release now.

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
2. `launchctl bootout gui/$(id -u)/local.imsg-web`
3. Check the app and its imsg child are gone and port 8787 is closed.

If it does not stop cleanly or a lock remains, leave the lock where it is and
ask the owner. Never delete lock or socket files automatically, and never
`killall imsg`: the iMac runs another system's imsg.

## Update

Put the new build in a new `releases/<commit>/`, stop, point the plist at it,
start, log in and check, then `<base>/imsg-web prune`. To roll back, point the
plist at the previous release. The owner hash in `state/` is never rolled back.

**Renaming the agent.** The label is `local.imsg-web`; an installation from
before sending shipped answers to `local.imsg-web.readonly`. To move one across,
stop it under the old name, carry the logs over so their history is not orphaned
under a name nothing writes to any more, generate with `--label local.imsg-web`,
and start that:

```sh
launchctl bootout gui/$(id -u)/local.imsg-web.readonly
for s in out err; do mv "$B/logs/local.imsg-web.readonly.$s.log" "$B/logs/local.imsg-web.$s.log"; done
mv "$PL_OLD" "$B/local.imsg-web.readonly.plist.<release being replaced>"
# …generate with --label local.imsg-web --output ~/Library/LaunchAgents/local.imsg-web.plist…
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.imsg-web.plist
```

Nothing but launchctl reads the label: `<base>/imsg-web` finds the agent by the
release path inside its plist, so it keeps working across the change and after
any later one.

**Wrap a pasted deploy in a guard.** These commands are for the Mac, and a shell
on another machine will not refuse them — it will run each line and fail each one
differently, half of them looking like real errors. One `if` makes the whole
paste do nothing anywhere else:

```sh
if [ "$(uname)" != Darwin ]; then echo "This is for the Mac."; else
  # …the whole deploy…
fi
```

`exit` would do instead, except in an interactive shell, where it closes the
window the output was in.

## During the trial

The owner uses it normally. Occasionally check memory for the app and its child
(`ps -o rss= -p <pid>`) and that the logs stay small and free of message
content.

## When a send does not go

A send that fails before it reaches Messages leaves nothing behind: no message in
chat.db, no entry in the system log, nothing in Messages itself. So the server
writes one line about it, and only about it, to its error log:

```sh
tail -n 20 "$HOME/Library/Application Support/imsg-web/logs/local.imsg-web.err.log"
```

Each line says what shape the failure had — whether there was an attachment, how
far imsg got (`disposition`), whether it is safe to retry, the AppleScript error
number Messages returned, or, for a child that died before answering, its own
first line with paths, addresses and numbers already removed. No message text, no
recipient and no identifier is ever written. A send that works writes nothing.

If a send never reached imsg at all, the line begins `refused`, and names only the
route and the status.
