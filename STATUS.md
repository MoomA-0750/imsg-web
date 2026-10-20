# Status — 2026-10-20

## Where things are

**The M1 is in daily use** under a LaunchAgent, behind Tailscale Serve, with the
patched `imsg` 0.15.4 and real data. Reading, sending (text, files, recordings),
contact pictures, replies and tapbacks all work against the owner's own messages.
Live sending is enabled there.

**The iMac (Intel) has not been set up.**

What the app does, and the rules it keeps, are in `README.md`, `AGENTS.md` and
`docs/`. What real data proved — and disproved — is in
`docs/real-data-findings.md`. This file is only for what is unfinished or has yet
to be decided.

## Next

1. **Watch the M1** for memory, log size and anything that looks wrong.
2. **Then the iMac**, the same way (`docs/operations.md`), watching for the stale
   bridge lock issue noted in the findings.

## Open threads

- **An API for other programs** (`docs/api.md`), asked for so a home dashboard
  can show a chat panel: client tokens issued with `imsg-web client add`, scoped
  `read` or `send`, on the same routes the page uses. On the M1 since
  2026-10-21 (8ac2fe9); no client has been issued yet, so nothing has used it
  against real data. The dashboard side is not part of this repository.
- **Slow start after that update.** The new release took about two minutes from
  launch to listening; the system log showed nothing about why. If a restart is
  slow again, find out where the time goes before blaming the network.

- **One https address.** The server has a single listener, https with a
  self-signed certificate the installer makes, open to the LAN by default
  (`--no-lan` for loopback only); the Mac and the LAN both use
  `https://<name>.local:8787`. On the M1 since 2026-10-20, with Tailscale Serve
  now proxying to `https+insecure://127.0.0.1:8787`; checked from another machine
  on the LAN, from the Mac itself, and over the tailnet. The owner's iPhone,
  from outside over the Mac's Tailscale IP (which the server answers to as one
  of its own addresses, no Serve involved), accepted the certificate, signed in
  and recorded. A Windows PC on the home LAN opened it by the `.local` name.
  Not yet tried: the `.local` name from the iPhone itself.
- **The generator's disk tests fail on macOS** (and passed on Linux): they work
  under `/tmp`, which is a symlink there, and the generator refuses symlinked
  ancestors. A test-fixture problem, not a product one; it predates the LAN work.

- **Sends that do not go.** The owner saw voice messages fail or come back
  "unknown". Every send that reached imsg was delivered, so the failures never
  reach it, and they leave no trace in chat.db, the system log, or Messages. The
  send path now writes one line per failure to the LaunchAgent's error log
  (`docs/operations.md` says where and what is in it); imsg's stderr used to be
  thrown away, which is why there was nothing to read. It has not recurred since.
  **If it does: read that log.**
- **Publishing.** The repository is public as of 2026-09-16: MIT, full history,
  with the real-data record kept but the author's own message counts taken out of
  it. `scripts/setup.sh` is the setup path an outsider follows: it fetches Node,
  builds the app and the patched imsg, and calls `install.sh`, which issues a
  temporary password; the first sign-in asks for the owner's own. On 2026-10-20
  the M1's install was set aside and replaced by one `setup.sh` run from a fresh
  copy: it went through unattended, and the owner's iPhone signed in with the
  temporary password, chose a password and reached a conversation. Full Disk
  Access carried over because the Node path was unchanged; a machine that has
  never had it still needs the one manual grant, and nobody has yet installed
  on such a machine.

## Settled, and not to be re-opened without new grounds

- **A recording cannot be made into a voice message** over the AppleScript
  transport. Tested 2026-09-16 with a byte-identical Opus/CAF file named
  `Audio Message.caf`: Messages still recorded `is_audio_message=0`. The flag
  belongs to the sending client, and imsg sets it only over the bridge.
- **Sending a reply or a tapback** needs that same bridge (SIP off, code injected
  into Messages), so neither is offered. Replies and tapbacks are shown, not sent.
- **Read state and typing** are not approved and not implemented.
- **The bridge itself** would answer all three, at the cost of SIP. Out of bounds
  unless the owner decides otherwise, in which case the cost gets researched
  first.

## Leftovers on the Macs

The M1 keeps the running release plus one rollback step. Pruning is
`<base>/imsg-web prune`, the last step of a deploy; it lived in `/tmp` until
2026-09-16, which macOS cleared, so several handovers pruned nothing and four
releases accumulated. Temporary build and measurement directories remain on the
Intel Mac. Specifics are in the owner's private notes, not here.

## Standing rules

See `AGENTS.md`. In short: never record message content or private identifiers;
never touch SIP/TCC, Messages.app, the owner's other bridge system or its lock
files; no push, Serve change or production start without the owner's approval.
