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
  out of bounds.
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
  app. Group photos (6 chats) are likewise not exposed.

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
on the Mac with the system `sips`, unless the browser's `Accept` names the
original type (Safari names HEIC and gets the original). macOS 27 on the M1 can
write AVIF and JPEG but only read WebP, so the target is AVIF when accepted,
else JPEG; a failed conversion falls back to JPEG, then to the original. `sips`
works on a copy of the checked bytes in a private directory under the child
TMPDIR, which is removed afterwards. Two facts about `sips` shaped this: it
exits 0 when it fails (success is judged by the output's first bytes), and
`-Z` also enlarges (it is applied only to images larger than 2048 px). On the
M1, under load, a first view took about 0.5–2.5 s for AVIF and 0.5–1.8 s for
JPEG; AVIF was roughly half the size. Conversions are kept in memory (64 MiB)
and repeat views took a few milliseconds. At most two run at once. An older
macOS that cannot write AVIF simply gets JPEG.

How images are served (branch `attachment-images`): history registers an
opaque per-epoch ID only for a present image of an allowed type (JPEG, PNG,
GIF, WebP, HEIC/HEIF, JPEG XL; never SVG). `/api/attachments/:id` needs a
session, resolves symlinks and serves the file only if it lies inside
`Messages/Attachments`, is a regular file of at most 32 MiB whose first bytes are an allowed image, with that detected
type, `no-store`, `nosniff` and a `sandbox` CSP. Paths and file names never
reach the browser. Anything else is shown as a line of text saying why.

## Known and not yet resolved

- **Intel with a stale bridge lock.** The iMac also runs the owner's separate
  message-bridge system. If its ready lock is present while Messages is not
  running, `status` waits about 10 seconds for a bridge that is not there, which
  can make the app's reader time out. In normal use Messages runs and the bridge
  answers, so this should not appear. It is the first thing to watch for in the
  iMac trial. This app must not remove that lock.
- **Nothing has been run on Intel yet** with the patched build, including
  whether Full Disk Access on the Intel Node lets names resolve.
