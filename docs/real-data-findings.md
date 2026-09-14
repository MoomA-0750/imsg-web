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

## Known and not yet resolved

- **Intel with a stale bridge lock.** The iMac also runs the owner's separate
  message-bridge system. If its ready lock is present while Messages is not
  running, `status` waits about 10 seconds for a bridge that is not there, which
  can make the app's reader time out. In normal use Messages runs and the bridge
  answers, so this should not appear. It is the first thing to watch for in the
  iMac trial. This app must not remove that lock.
- **Nothing has been run on Intel yet** with the patched build, including
  whether Full Disk Access on the Intel Node lets names resolve.
