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

## Reading through long lists

A conversation opens on its newest message and stays there while new ones
arrive. Scrolling near the top fetches the previous 50 and holds the view on the
message it was on. The conversation list pages the same way downwards, with no
button at all; a pane too tall for one page tops itself up, since scrolling
cannot ask when there is nothing to scroll. Both stop on their own when a read
returns fewer rows than were asked for, which is the only evidence that there
are no more. The button above the oldest message remains as the fallback there.

Only `thread_originator_guid` counts as a reply. The first release quoted on
`reply_to_text` alone, and the owner saw consecutive messages drawn as a chain of
replies: Messages sets `reply_to_guid` on ordinary messages too, and imsg falls
back to it. See `docs/real-data-findings.md`.

## Faces (2026-09-15)

A conversation shows its contact's picture where the address book has one, and
initials over a colour derived from the name where it does not — and in a group,
the sender's face sits at the foot of the last bubble of their run. Only 8 of 304
contacts have a usable picture; `docs/real-data-findings.md` says why, and why
exporting or syncing would not add any. The app reads them itself with
`node:sqlite`, matching on the name imsg already resolved.

A group has no picture of its own, so its row wears its members' faces gathered in
one circle — one place each, a stranger's silhouette where there is no picture. Its
members arrive as bare handles with no name resolved, so those are matched on the
handle instead: see `docs/real-data-findings.md` for the rule and what it hits.

## Voice (2026-09-15)

A voice message plays in place, and one can be recorded to send. Both directions
go through `src/server/audio-convert.ts` and the system `afconvert`: what Messages
records is CAF, which nothing outside Safari plays, and what a browser can record
is uncompressed PCM, which is ten times the size it needs to be. Recording is an
AudioWorklet at 16 kHz mono (`web/src/recorder.ts` and `pcm-worklet.js`), and what
it produces waits with the other attachments rather than being sent by itself.

The attachment route now answers a byte range for audio, because a player will not
offer to move about a recording unless the server says parts can be asked for.

## Sends that do not go (2026-09-15)

The owner reported voice messages failing or coming back "unknown" fairly often.
What the M1 shows: every send that reached imsg went and was delivered — 5 in the
evening window, 3 of them recordings, all `is_sent=1 is_delivered=1 error=0`, each
with its own osascript run and staged file. So the failures never reach imsg, and
they leave no trace in chat.db, the system log, or Messages.

The send path now writes one line per failure to the LaunchAgent's error log
(`docs/operations.md` says where and what is in it): shapes only — attachment or
not, imsg's code, `disposition`, `retry_safe`, the AppleScript error number, or
the first line of a child that died before answering, with paths, addresses and
numbers removed. imsg's stderr used to be thrown away, which is why there was
nothing to look at. **Next step: the owner reproduces a failure and reads that
log.**

## The unread count (2026-09-15)

`unread_count` counted every message with `is_read = 0` over a conversation's
whole history, which badged conversations the owner had read elsewhere. A fourth
patch, `imsg-patches/unread-mark`, adds Messages' own per-chat read mark to the
condition. Built and deployed by the owner on 2026-09-15; the badges now agree
with Messages.

## Next

1. Owner keeps using the M1 trial for a few days. Watch memory, log size and
   anything that looks wrong.
2. Then the iMac, the same way (`docs/operations.md`), watching for the stale
   bridge lock issue noted in the findings.

Branch `attachment-images` (not merged) was where images and link cards were
built; both have long since shipped from the main line. It has nothing left in
it that is not elsewhere, and can be deleted whenever the owner wants.

## Leftovers on the Macs

The M1 was pruned on 2026-09-15 to the running release plus one rollback step;
the Node runtime, state and the live agent's logs were left alone, and pruning is
now part of handing over a release rather than something to catch up on later.
Temporary build and measurement directories remain on the Intel Mac. Specifics
are in the owner's private notes, not here.

## Standing rules

See `AGENTS.md`. In short: never record message content or private identifiers;
never touch SIP/TCC, Messages.app, the owner's other bridge system or its lock
files; no push, Serve change or production start without the owner's approval.
