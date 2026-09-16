# Status — 2026-09-16

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

- **Sends that do not go.** The owner saw voice messages fail or come back
  "unknown". Every send that reached imsg was delivered, so the failures never
  reach it, and they leave no trace in chat.db, the system log, or Messages. The
  send path now writes one line per failure to the LaunchAgent's error log
  (`docs/operations.md` says where and what is in it); imsg's stderr used to be
  thrown away, which is why there was nothing to read. It has not recurred since.
  **If it does: read that log.**
- **The LaunchAgent is still named `local.imsg-web.readonly`**, which stopped
  being true when sending shipped. Rename it at the next big swap; the owner
  asked for this.

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
