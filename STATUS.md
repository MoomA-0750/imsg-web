# Status — 2026-09-14

## Where things are

**M1 trial running** since 2026-09-14: the web UI on the M1 Mac under a
LaunchAgent, behind Tailscale Serve, with the patched `imsg` 0.15.4 and real
data. The owner confirmed messages load, contact names show (list and group
senders), attachments show as a count, and speed feels fine. Three bugs found on
the way are fixed; see `docs/real-data-findings.md`.

The iMac (Intel) has not been set up.

## Simplified on 2026-09-14

The project had grown a heavy gate process: provenance classes, generated shell
scripts with guard tests, parity and timing harnesses, and a 30-minute
two-arm, two-host C06 soak. On the owner's decision that was dropped in favour
of a direct trial. Everything removed is preserved, with full history, in a
separate local copy of the repository (`imsg-web-archive`, at `ab503f7`).

Two app fixes came out of that work and are in: the reader now passes
`--contacts-from-address-book`, and `status` is reused for 60 seconds instead of
running on every request.

## Next

1. Owner keeps using the M1 trial for a few days. Watch memory, log size and
   anything that looks wrong.
2. Then the iMac, the same way (`docs/operations.md`), watching for the stale
   bridge lock issue noted in the findings.

Optional, on branch `attachment-images` (not merged, not deployed): shows
images that are on the Mac. Findings and the serving rules are in
`docs/real-data-findings.md`. Profile pictures were looked at and not built.

## Leftovers on the Macs

Temporary build and measurement directories remain on both Macs, and one test
LaunchAgent plist (already unloaded) remains on the M1. On the M1, older
releases and the previous trial plist (kept as a rollback copy) sit beside the
running release. Nothing was deleted;
removing them is the owner's call. Specifics are in the owner's private notes,
not here.

## Standing rules

See `AGENTS.md`. In short: never record message content or private identifiers;
never touch SIP/TCC, Messages.app, the owner's other bridge system or its lock
files; no push, Serve change or production start without the owner's approval.
