# imsg-web

**English** · [日本語](README_ja.md)

Read and send your iMessages from a browser, served by your own Mac.

It is a small web UI over the [`imsg`](https://github.com/openclaw/imsg) CLI: your
Mac keeps the messages, a local server reads them, and you reach that server over
your own [Tailscale](https://tailscale.com) network from a phone or another
computer. Nothing is mirrored to a server anyone else runs, nothing is exposed to
the public Internet, and no message ever leaves your machine except to the browser
you signed into.

It is built for **one person on their own Mac**. There are no accounts, no
multi-user anything, and no attempt at being a product.

## What it does

Read: the conversation list with the newest message on each row, history that
opens at the newest and pages as you scroll, images that are on the Mac (or
Messages' cached thumbnail when the full image was never downloaded), contact
pictures from the address book, voice messages played in place, link cards, the
message a reply answers, and the tapbacks on a message.

Send — **off unless you turn it on**: text, files, and voice recordings made in
the browser.

It does **not** send replies or tapbacks, change read state, show typing, or
search. The first two need imsg's bridge transport, which wants SIP disabled and
code injected into Messages; this project does not go there.

## What it needs

- **A Mac** that is signed into Messages and stays awake. Everything runs there.
- **`imsg`, built with the patches in [`imsg-patches/`](imsg-patches/).** Four
  small changes upstream does not carry: contact names under a LaunchAgent,
  faster contact lookup, link previews, and an unread count that matches
  Messages. That directory says what each one does and how to build it.
- **Node 24**, unpacked somewhere of its own. Not the system Node, and not
  Homebrew's: this one gets Full Disk Access, so it should be a copy you control.
- **Tailscale**, or another way to reach the Mac privately. The server binds
  loopback only and refuses any `Origin` but the one it was configured with, so
  it is not reachable from the network without something in front of it.

## Setting it up

```sh
git clone https://github.com/MoomA-0750/imsg-web && cd imsg-web
npm ci --ignore-scripts
npm run build

./scripts/install.sh \
  --imsg /path/to/patched/imsg \
  --node /path/to/node-v24.20.0-darwin-arm64 \
  --origin https://your-mac.your-tailnet.ts.net
```

That lays out a private directory under `~/Library/Application Support/imsg-web`,
installs the build as a release, asks you for a password, writes the LaunchAgent
and starts it. Run the same command again after `npm run build` to install a new
release; the previous one stays as the way back, and older ones are pruned.

Two things it cannot do for you, and will remind you about:

- **Full Disk Access** for the Node binary it installed (System Settings →
  Privacy & Security). macOS holds *that* binary responsible for reading
  `chat.db`, not your terminal.
- **Putting the port on your tailnet**: `tailscale serve --bg 8787`.

Then open the address you gave it and sign in. Sending stays off until you
install with `--send dry-run` (which validates and dispatches nothing) or
`--send live`.

Details, including how to stop it, roll back, or rename the agent, are in
[`docs/operations.md`](docs/operations.md).

## How it is kept safe

The threat it takes seriously is the obvious one: this reads every message you
have, so it should be hard to reach and impossible to reach by accident.

- **Loopback only.** The server binds `127.0.0.1`. Whatever fronts it — Tailscale
  Serve, an SSH tunnel — is what decides who can connect at all.
- **One password**, hashed with scrypt, stored in a 0700 directory. Sessions are
  `__Host-` cookies, `Secure`, `HttpOnly`, `SameSite=Lax`, and lapse after a day
  idle or a week outright.
- **Exact `Origin` and `Host` checks** on every request, a CSRF token on every
  mutation, and a login rate limit.
- **The read path can only read.** The RPC client enforces a method allowlist —
  `status`, `chats.list`, `messages.history`, `watch.*` — at run time, not merely
  in types. Sending is a separate client and a separate process, and the two
  never share a path.
- **Nothing leaves the Mac.** No push service, no analytics, no fetching of link
  previews (Messages already stored them), no outbound request of any kind. The
  page's CSP allows `'self'` and nothing else.
- **Identifiers do not cross.** Chat and message ids in the browser are HMACs
  bound to the database generation; paths, handles and filenames never reach it.
  Replace `chat.db` and every id the browser holds stops meaning anything.

None of that makes it safe to expose publicly, and it is not built to be.

## What the screen does not say

Behaviour worth knowing, kept out of the UI so it does not explain itself at you
every time:

- **Attachments go one per message.** imsg sends a single file per send, so ten
  files arrive as ten messages, in the order they were chosen, with any text on
  the first. A batch stops at the first that does not go and says how far it got.
- **Sending is immediate** — no confirmation, and nothing is said when it works:
  the message appearing and the composer emptying is the confirmation. Only a
  failure, or a send whose outcome imsg could not vouch for, puts a line on the
  screen. Ctrl+Enter or ⌘+Enter sends, and so does the round button. The field is
  labelled with the service it will send over, `iMessage` or `SMS`, and nothing else.
- **A blue bubble means iMessage, green means anything else** (SMS, RCS, or a
  service imsg did not report), the way Messages colours them. imsg reports the
  service per conversation, so a conversation that fell back for one message
  still reads as one colour.
- **A conversation list row shows its newest message**, read separately from the
  list itself; a row still blank has not been read yet, which is not the same as
  having no messages.
- **Reading refreshes itself** every 15 seconds and whenever the tab is returned
  to. There is no refresh button. A read that fails offers 再試行.
- **There is no sign-out.** One owner, one account: a session lapses on its own,
  and `auth revoke-all` ends every session at once from the Mac. The sign-in
  screen's "パスワードを忘れた場合" carries the other two administration commands.
- **Scrolling pages both lists** — up through a conversation, down through the
  list — and stops when a read returns fewer rows than it asked for.
- **A picture opens.** Clicking one that is on the Mac shows it as large as the
  window allows, however tall it is. The wheel, a pinch, or a double click scales
  it about whatever is under the pointer, and a drag moves it once there is more
  of it than fits; Escape, the backdrop, or pulling it down closes it. Messages'
  cached thumbnail of a picture that was never downloaded cannot open any larger,
  so clicking it says so over the picture for a couple of seconds. Nothing is
  written under a thumbnail otherwise: the two look alike until you try.
- **A voice message plays where it sits**, with a bar that fills as it goes and
  moves to wherever it is pressed. Messages records these as CAF, which nothing
  outside Safari plays, so the Mac re-encodes one to AAC the first time it is
  played and keeps that; the recording itself is never altered.
- **Recording is a button, not a hold.** With nothing written, the button on the
  right offers the microphone; it becomes the send button as soon as there is
  something to send. What was recorded waits with the other attachments — listen
  back, throw it away, or write something to go with it — and sending it is a
  separate act. A browser can only write uncompressed PCM, so the Mac re-encodes
  a recording to AAC on the way through: about a tenth of the size, and what a
  phone expects to be handed. It stops itself after five minutes. It arrives as an
  audio attachment rather than the waveform bubble the Messages app makes: that
  bubble comes from a flag the sending app sets, which this transport cannot set —
  tested, with the identical file, in [`docs/real-data-findings.md`](docs/real-data-findings.md).
- **A reply's quote is the way back to it.** Pressing it goes to the message
  being answered and rings it for a couple of seconds, which is the only way to
  pick it out once the screen has moved. If that message is further back than has
  been read, the rest of the conversation is fetched once — up to the 1000-row
  ceiling — and the screen goes there when it lands; beyond that it says so
  rather than pretending.
- **Notifications are off until asked for.** The bell beside メッセージ turns them
  on, which is also when the browser is asked for permission; what was already
  there is not announced, and neither is a message you sent from another device,
  nor one arriving in the conversation on screen. They are drawn by your browser
  alone — nothing is registered with a push service and nothing is sent anywhere.
  With them on, a hidden tab keeps asking for the conversation list once a minute
  instead of stopping; without them it stops. iOS Safari shows notifications only
  for a page added to the Home Screen.
- **Times are not printed on every message.** A line marks where each day begins
  and where a conversation resumes after an hour's quiet; dragging the
  conversation to the left uncovers the time of every message beside it, and lets
  go when you do. The times are in the page either way, so a screen reader reaches
  them without the drag.

The interface is in Japanese, because the person it was built for reads Japanese.
Nothing about it is language-specific beyond the strings.

## Development

Put a dedicated Node **24.20.0** first in `PATH` (do not replace the system
Node), then:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:browser     # synthetic HTTPS, Chromium
```

Tests use synthetic data only and never run a real `imsg`. There is no fixture
anywhere in this repository that came from a real conversation.

`npm run doctor` calls upstream `imsg status`, which may launch or repair
Messages.app. It is not a harmless check.

## Where things are

- [`imsg-patches/`](imsg-patches/) — the four patches, and how to build imsg with them
- [`docs/operations.md`](docs/operations.md) — install, LaunchAgent, Serve, stop, update, and what to do when a send fails
- [`docs/architecture.md`](docs/architecture.md) — the read-only RPC contract, and how attachments, faces and audio are handled
- [`docs/real-data-findings.md`](docs/real-data-findings.md) — what real data proved, and disproved, about Messages' own storage
- [`docs/demo-preview.md`](docs/demo-preview.md) — a synthetic preview for trying the UI without any real data
- [`AGENTS.md`](AGENTS.md) — the boundaries this project keeps, written for whoever works on it next

## Licence

MIT. See [LICENSE](LICENSE).

`imsg` itself is MIT, © Peter Steinberger; the patches in `imsg-patches/` are
changes to that source and carry its licence.
