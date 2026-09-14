# Status — 2026-09-14

## Where things are

The read-only web UI is implemented and tested on synthetic data. On the M1 Mac,
the patched `imsg` 0.15.4 was run against real data: it modified nothing,
contact names resolved (including under a LaunchAgent), output matched the stock
build, and it was about 3× faster. See `docs/real-data-findings.md`.

Production is **stopped**. It has never been run with real data through the web
UI.

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

1. Build the patched `imsg` on the iMac (Intel) or reuse the build already made
   there, and set up a release directory (`docs/operations.md`).
2. Owner grants Full Disk Access to the dedicated Node, places the LaunchAgent
   plist, sets the owner key, and approves the Serve route.
3. Owner uses the UI for a few days. Watch for: names showing, speed, memory,
   and the stale bridge lock issue noted in the findings.

## Leftovers on the Macs

Temporary build and measurement directories remain on both Macs, and one test
LaunchAgent plist (already unloaded) remains on the M1. Nothing was deleted;
removing them is the owner's call. Specifics are in the owner's private notes,
not here.

## Standing rules

See `AGENTS.md`. In short: never record message content or private identifiers;
never touch SIP/TCC, Messages.app, the owner's other bridge system or its lock
files; no push, Serve change or production start without the owner's approval.
