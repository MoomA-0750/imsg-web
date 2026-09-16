# What the screen does not say

Behaviour worth knowing, kept out of the UI so it does not explain itself at you
every time. None of it is needed to use the app; it is here for when something
looks wrong and is not.

## Sending

- **Attachments go one per message.** imsg sends a single file per send, so ten
  files arrive as ten messages, in the order they were chosen, with any text on
  the first. A batch stops at the first that does not go and says how far it got.
- **Nothing is said when a send works.** The message appearing and the composer
  emptying is the confirmation. Only a failure, or a send whose outcome imsg
  could not vouch for, puts a line on the screen — and the second of those keeps
  your text, because sending it again might double it.
- **A recording arrives as an audio attachment**, not the waveform bubble the
  Messages app makes. That bubble comes from a flag the sending app sets, which
  this transport cannot set; it was tested with a byte-identical file, and
  [`real-data-findings.md`](real-data-findings.md) has the result.
- **A blue bubble means iMessage, green means anything else** (SMS, RCS, or a
  service imsg did not report), the way Messages colours them. imsg reports the
  service per conversation, so a conversation that fell back for one message
  still reads as one colour.
- **A send that never reaches imsg leaves no trace anywhere** except the
  server's error log. [`operations.md`](operations.md) says where that is.

## Reading

- **A conversation list row shows its newest message**, read separately from the
  list itself; a row still blank has not been read yet, which is not the same as
  having no messages.
- **Reading refreshes itself** every 15 seconds and whenever the tab is returned
  to. There is no refresh button. A read that fails offers 再試行.
- **Scrolling pages both lists** — up through a conversation, down through the
  list — and stops when a read returns fewer rows than it asked for, which is
  the only evidence that there are no more.
- **A conversation holds at most 1000 messages** at once. A reply whose parent is
  older than that says so rather than pretending to look.
- **Times are not printed on every message.** A line marks where each day begins
  and where a conversation resumes after an hour's quiet. The times are in the
  page either way, so a screen reader reaches them without the drag.

## Attachments

- **Most attachments are not on the Mac.** Messages keeps them in iCloud until
  they are opened, so an image that was never opened on this Mac has no file
  here. Downloading it would mean driving Messages.app, which this does not do.
- **Messages' cached thumbnail stands in** where there is one, and it cannot open
  any larger — clicking it says so over the picture for a couple of seconds.
  Nothing is written under a thumbnail otherwise: it and a real picture look
  alike until you try.
- **HEIC and JPEG XL are converted to JPEG** for browsers that cannot draw them,
  unless the browser says it accepts the original. Safari gets the original.
- **A voice message is converted to AAC the first time it is played**, because
  Messages records these as CAF, which nothing outside Safari plays. The
  recording itself is never altered.

## Notifications

- **They are off until asked for**, and asking is what requests permission from
  the browser. What was already there is not announced, nor is a message you
  sent from another device, nor one arriving in the conversation on screen.
- **They are drawn by your browser alone.** Nothing is registered with a push
  service and nothing is sent anywhere.
- **A hidden tab keeps asking once a minute** while they are on, and stops
  entirely while they are off.
- **iOS Safari shows them only for a page added to the Home Screen.**

## There is no sign-out

One owner, one account. A session lapses on its own after a day idle or a week
outright, and `auth revoke-all` ends every session at once from the Mac. The
sign-in screen's "パスワードを忘れた場合" carries the other administration
commands, so being locked out does not mean going looking for a file.
