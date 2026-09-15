# What real data showed (2026-09-13 – 09-14)

Checked on the M1 Mac with the owner's permission. The detailed step-by-step
records, measurement scripts and the C06 harness were archived outside this
repository when the project was simplified on 2026-09-14.

## Confirmed

- **Read-only really is read-only.** Opening the real `chat.db` through
  `imsg rpc` modified nothing, not even an mtime. Messages.app was not running.
- **Contact names resolve** with the contact-source patch, both over SSH and
  under a LaunchAgent (launchd → dedicated Node → imsg). Phone-number
  normalisation works. No Contacts grant was requested and no prompt appeared.
  Under a LaunchAgent the process macOS holds responsible is the dedicated Node,
  so Full Disk Access belongs on that Node.
- **The contact-batch patch changes speed, not output.** Stock and patched
  builds returned identical data for 25 chats and 125 messages.
- **The patch is about 3× faster.** Warm UI cycle at the RPC level: median
  835 ms stock, 264 ms patched. The stock build also drifted about 26% between
  runs, so read the ratio, not the milliseconds.

## Found, and fixed in the app

- **The app did not pass the contact flag.** It spawned `imsg rpc` bare, so
  names would not have resolved in production. It now passes
  `--contacts-from-address-book`.
- **Every API request ran `status`,** three per UI poll. Where the Messages
  bridge is installed, `status` exchanges files with that bridge each time. It
  is now reused for 60 seconds.

## Found in the first M1 trial (2026-09-14)

- **`imsg` needs its resource bundles beside it.** Copied alone into a release
  it crashed on the first request, and the UI could only say it could not
  refresh. With `PhoneNumberKit_PhoneNumberKit.bundle` and
  `SQLite.swift_SQLite.bundle` next to it: status 491 ms cold, chats 42 ms,
  history 51 ms. Build notes in `imsg-patches/README.md` now say so.
- **Names were resolved but not shown.** imsg returns them in `contact_name`
  (chats) and `sender_name` (messages); the adapter read neither, so the list
  showed phone numbers and email addresses. Fixed, along with group senders.
- **Photos showed as a stray glyph**, the U+FFFC marker Messages leaves in the
  text. Now shown as an attachment count.
- After those fixes the owner confirmed through the web UI under the
  LaunchAgent: messages load, contact names show in the list and for group
  senders, attachments show as a count, and it does not feel slow.

## Attachments and profile pictures (2026-09-14)

Surveyed on the M1 with aggregate counts only, to decide what showing images
would take.

- **Most attachments are not on the Mac.** Of the 300 newest attachment rows,
  243 had no file (Messages keeps them in iCloud until opened). In a 28-chat,
  881-message sample, 83 of 112 were marked `missing`. Only files already on
  the Mac can be shown; downloading would mean driving Messages.app, which is
  out of bounds. Of the 740 newest image attachments, the 706 with
  `transfer_state` 0 were all absent and 33 of the 34 with state 5 were present:
  the files were never downloaded to this Mac, not deleted from it. Recent
  images are no exception (21 of 34 from the last 30 days absent). The owner
  opened such images in Messages.app and they did not always appear.
- **Types:** JPEG and PNG dominate, then HEIC (about a sixth of images) and a
  little JPEG XL. Chrome and Firefox cannot decode HEIC or JPEG XL; Safari can.
- **Link previews arrive as attachments**: an untyped
  `.pluginPayloadAttachment`. They are not listed as attachments; the link card
  below uses them.
- `messages.history` with `attachments: true` returned the fields the app needs
  (`original_path`, `mime_type`, `missing`, `is_sticker`); history stayed about
  30 ms per 50 messages. `convert_attachments` stays off, so imsg never runs a
  converter or writes a cache.
- **Profile pictures are rare and not exposed by imsg.** The address book held
  about 300 contacts and 13 thumbnails. imsg does not return them, so showing
  them would need another imsg patch or a second address-book reader in the
  app. Group photos (6 chats) are likewise not exposed. The app now reads them
  itself; see below.

**Link previews.** The sender's device fetches the page and Messages stores the
result with the message, so nothing has to be fetched again (and fetching from
the Mac would tell the site, and the sender, when a link was viewed). About 60
of 66 recent link messages carried title, site and URL in `payload_data`; the
preview image is one of that message's attachments, usually not on the Mac. imsg
does not return any of it, hence `imsg-patches/link-preview`. With the patch, in
a 28-chat sample all 19 link messages decoded (title 19, summary 18, site name
14); 5 preview images were on the Mac, all real images, three of them JPEG
recorded as PNG. One preview attachment elsewhere turned out to be an HTML page,
so files are checked by their first bytes and served with the type found there.
The card opens the link in a new tab with no referrer; only absolute http(s)
URLs become links.

**HEIC and JPEG XL.** The owner's browser drew neither, so they are converted
to JPEG on the Mac with the system `sips`, unless the browser's `Accept` names
the original type (Safari names HEIC and gets the original). A failed
conversion sends the original.

- Formats compared on a 2.2 MB, 5712 px photo, seven interleaved runs under
  load (medians): JPEG 0.30 s / 688K, AVIF 0.50 s / 468K, WebP 0.74 s / 300K.
  macOS 27 reads WebP but cannot write it, so WebP needed libwebp's `cwebp`
  after a `sips` TIFF step, which made it the slowest. The owner chose JPEG:
  fastest, and every format looked fine to them. Small images took about 0.4 s
  in any format; that is mostly `sips` itself.
- The newest 20 present convertible images of each history response are
  converted ahead in the background, using at most one of two slots and
  yielding to views; the file is checked again when that work starts. On the
  M1 a first view after preparation took about 1 ms.
- `sips` only ever sees a copy of the checked bytes in a private directory under
  the child TMPDIR, removed afterwards. It exits 0 when it fails (success is
  judged by the output's first bytes), and `-Z` also enlarges (it is applied
  only above 2048 px). Conversions stay in memory (64 MiB).

**Thumbnails of images never downloaded.** Messages caches a thumbnail at
`Caches/Previews/Attachments/<same relative directory>/<stem>-preview.ktx`, in
Apple's texture format (`AAPL\r\n\x1a\n`), which `sips` converts. 180 of 707
absent images (about a quarter) had one; the rest have neither file nor
thumbnail. With the owner's approval the app now also reads that cache: the
path is derived lexically from a path inside `Messages/Attachments`, the file
must lie inside the preview cache after symlinks are resolved and start with
that signature, and it is only ever served converted to JPEG, with a caption
saying the original is not on the Mac. On the M1 all 40 tried were served,
median 44K and 82 ms. Messages may drop that cache at any time.

How images are served (branch `attachment-images`): history registers an
opaque per-epoch ID only for a present image of an allowed type (JPEG, PNG,
GIF, WebP, HEIC/HEIF, JPEG XL; never SVG). `/api/attachments/:id` needs a
session, resolves symlinks and serves the file only if it lies inside
`Messages/Attachments` (or, for a thumbnail, the preview cache), is a regular
file of at most 32 MiB whose first bytes are an allowed image, with that
detected type, `no-store`, `nosniff` and a `sandbox` CSP. Paths and file names never
reach the browser. Anything else is shown as a line of text saying why.

**Replies and tapbacks.** Both are already in what `messages.history` returns, so
showing them needs nothing new: `reply_to_text`/`reply_to_sender` for the message
a reply answers, and a `reactions` array. In a 28-chat, 881-message sample, 69
messages carried 72 tapbacks (25 love, 25 like, 18 custom, 3 laugh, 1 emphasis) —
common enough to be worth drawing. *Sending* either is not possible on this path: imsg
answers `reply_to requires bridge transport; AppleScript fallback cannot send
threaded replies`, and `tapback` is declared bridge-only. The bridge means SIP
off and code injected into Messages, so replies and tapbacks are display-only.

**`reply_to_guid` is not a reply.** Only `thread_originator_guid` marks a threaded
reply. Messages sets `reply_to_guid` on ordinary messages as well, almost always to
the message just before: in the newest 4000 non-reaction rows, 889 carried
`reply_to_guid` but only 66 were threaded replies, and 732 of the other 847 pointed
at the immediately preceding message in the same chat. imsg resolves the quote from
`thread_originator_guid` first and *falls back* to `reply_to_guid`, so
`reply_to_text` alone turns every run of consecutive messages into a chain of
replies — each one quoting the one above it. The flag has to gate the quote. On the
real replies the fallback is harmless anyway: all 66 originators resolved, though on
34 of them `reply_to_guid` pointed somewhere else entirely.

**The unread count was counting messages already read.** `unread_count` came from
`is_read = 0` over a conversation's whole history, and that flag only records that
*this Mac* saw a read receipt — a message read on the phone keeps it at 0 for ever.
139 messages across 18 conversations were being badged; 70 of them sat at or below
the conversation's own `chat.last_read_message_timestamp`, the high-water mark
Messages itself keeps. Comparing the two side by side, Messages showed no badge on
conversations the app badged 9, 6 and 7. `imsg-patches/unread-mark` adds the mark to
the condition, leaving a conversation with no mark alone so one never opened still
counts, as Messages does. Afterwards: 69 messages across 8 conversations, agreeing
with Messages on every conversation checked.

**Contact pictures, looked at again (2026-09-15).** The limit was never access:
the pictures sit in the same address book the names already come from. It is that
there are hardly any. Of 304 contacts, 13 records carry image data, but two hold a
38-byte marker rather than a picture, one has no name to match on, and one name is
shared by two contacts and so cannot be told apart — leaving **8 usable**, 7 JPEG
and 1 PNG, 12–118 KB each, read in 75 ms. Exporting vCards would yield the same 8.
Nor is anything waiting to be fetched: across both synced accounts
`ZEXTERNALIMAGEURI` and `ZIMAGESYNCFAILEDTIME` are empty, so the accounts are not
holding pictures back. Google's People API could return profile photos that CardDAV
does not sync, but that means network access from the Mac, OAuth credentials and
contact identifiers leaving the machine; it was not pursued.

The app reads them with `node:sqlite` (built into Node, no dependency added),
matching on the name imsg already resolved: imsg matched the handle to one of these
records with a phone-number library this app does not have, so the name is the far
end of a match that just succeeded. A name two contacts share is dropped rather than
guessed at. Apple stores the picture one byte in, and a record can hold a short
marker instead, so the bytes are accepted only from a JPEG or PNG signature onwards.
Conversations without one show initials over a colour derived from the name, which
is what Messages does.

**A group's members (2026-09-15).** A group has no picture of its own, and no name
to match one on: `chats.list` already carries `participants`, but they are bare
handles, and imsg resolves contact names only for one-to-one conversations. So for
those the app matches on the handle itself, from the phone and address tables of the
same address book — an address lowercased, a number cut to its last 9 digits so a
card written `090-…` answers for the `+8190…` Messages holds. That rule is blunt:
two numbers ending alike collide, so a key two contacts claim is dropped rather than
shown as either. Measured over the owner's data: 8 group conversations, 14 distinct
members, **8 matched**; 5 of the 8 groups have every member matched and every group
has at least one. A group wears those faces gathered in one circle, one place per
member whether or not there is a picture, so the face still says how many people are
in there. Nothing but the pictures crosses to the browser: an id is an HMAC over the
handle, which the browser never sees.

## Known and not yet resolved

- **Intel with a stale bridge lock.** The iMac also runs the owner's separate
  message-bridge system. If its ready lock is present while Messages is not
  running, `status` waits about 10 seconds for a bridge that is not there, which
  can make the app's reader time out. In normal use Messages runs and the bridge
  answers, so this should not appear. It is the first thing to watch for in the
  iMac trial. This app must not remove that lock.
- **Nothing has been run on Intel yet** with the patched build, including
  whether Full Disk Access on the Intel Node lets names resolve.
