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
Reply-into-a-chat and send-to-a-handle are both supported. All tested
with synthetic fixtures — nothing real is sent.

Phase 2 (UI) is in: a composer under the open conversation that sends on click
or Ctrl/Cmd+Enter (the confirmation step was removed at the owner's request once
sending was proven), shows the outcome, and keeps the text when a send failed or
was ambiguous. It appears
only when the send capability is available, with a banner in dry-run. Failure,
rate-limit and stale-chat messages are handled (Phase 3 essentials).

The owner tried the composer on the M1 in dry-run (`--send dry-run`, release
`06facab`) and confirmed the UI is fine — nothing was sent. A first live attempt
failed: the initial code used `send.tracked`, which imsg rejects on the
AppleScript transport ("send.tracked requires bridge transport"). Fixed to plain
`send`; outcomes are now classified from imsg's `disposition`/`retry_safe`
(not-started → failed/safe-to-retry, otherwise unknown).

2026-09-15: a real message sent successfully from the web UI on the M1 (release
`6ea8900`, `--send live`). Sending works end to end over AppleScript. Live
sending is currently enabled on the M1.

Attachments can now be sent too: the browser uploads raw bytes to
`POST /api/uploads` (the one binary route, `application/octet-stream`, streamed
to a private 0700 directory, 100 MiB ceiling, 10-minute TTL, deleted after the
send), and the send refers to them by opaque ids. Text, files, or both. Up to
10 files: imsg takes one file per send, so each becomes its own message and a
batch stops at the first that does not go, reporting how far it got. The
composer previews each chosen file locally (blob URL; `img-src` allows `blob:`).
No silent compression — iMessage has its own size limit, which a large file will
find. Confirmed live on the M1 by the owner: a single image, several images at once
(each arriving as its own message), adding to the selection over several trips
to the picker, local thumbnails, and sending with Ctrl+Enter. A part-way batch
failure has not been exercised live (covered by synthetic tests only).

Branches: `send-messages` is being merged to `main`; `reply-reactions` sits on
top of it. `attachment-images` (notifications) is still unmerged and needs a
decision. The LaunchAgent is still named `local.imsg-web.readonly`, which no
longer fits — rename it at the next big swap (owner asked for this).

## Replies and tapbacks (branch `reply-reactions`)

Display only: a reply shows the message it answers (sender + a 200-character
quote) and tapbacks appear on the bubble, identical ones folded into a count
with the names in the tooltip. All of it was already in `messages.history`.
Sending a reply or a tapback is not possible without imsg's bridge transport
(SIP off + injection into Messages), so it is not offered.

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
