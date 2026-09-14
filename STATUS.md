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

## Sending (in progress, branch `send-messages`)

The owner approved adding sending. Phase 1 (server) is in: a separate send
client and service (`src/server/rpc/send-client.ts`, `src/server/send-service.ts`)
that never reuse the read-only path, a `POST /api/send` route (owner key + CSRF
+ its own rate limit), plain `send` over the AppleScript transport, and a
capability that reflects the mode. It is **off by default**; `IMSG_WEB_SEND`
selects `dry-run` (validate + resolve target, dispatch nothing) or `live`.
Reply-into-a-chat and send-to-a-handle are both supported; text only. All tested
with synthetic fixtures — nothing real is sent.

Phase 2 (UI) is in: a composer under the open conversation that requires an
explicit confirm before sending, shows the outcome, and on an ambiguous result
keeps the text and the same attempt_id so a retry cannot double-send. It appears
only when the send capability is available, with a banner in dry-run. Failure,
rate-limit and stale-chat messages are handled (Phase 3 essentials).

The owner tried the composer on the M1 in dry-run (`--send dry-run`, release
`06facab`) and confirmed the UI is fine — nothing was sent. A first live attempt
failed: the initial code used `send.tracked`, which imsg rejects on the
AppleScript transport ("send.tracked requires bridge transport"). Fixed to plain
`send`; outcomes are now classified from imsg's `disposition`/`retry_safe`
(not-started → failed/safe-to-retry, otherwise unknown). Needs a fresh live try.

Next: Phase 4 — the owner enables live on the Mac (`--send live`, Messages
signed in + an Automation grant) and sends one message to their own number.
Note: `send-messages` is off `main` and does not include the notifications
commit that had been running (`6427ffc`); the two branches still need reconciling.

## Next

1. Owner keeps using the M1 trial for a few days. Watch memory, log size and
   anything that looks wrong.
2. Then the iMac, the same way (`docs/operations.md`), watching for the stale
   bridge lock issue noted in the findings.

Branch `attachment-images` (not merged) shows images that are on the Mac and
link cards (needs `imsg-patches/link-preview`). It has been running on the M1
since 2026-09-14 (release `717939f`): the owner confirmed images show and link
cards open in a new tab, and converted HEIC displays. HEIC and JPEG XL are now
converted to JPEG (the owner's choice after comparing with AVIF and WebP) and
prepared ahead; images never downloaded show Messages' cached thumbnail when
there is one. Running on the M1 as release `037b496` since 2026-09-14; the owner
confirmed captioned thumbnails show and HEIC loads noticeably smoothly. Findings and the
serving rules are in `docs/real-data-findings.md`. Profile pictures were looked
at and not built.

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
