# imsg-web

**English** · [日本語](README_ja.md)

Read and send your iMessages from a browser, served by your own Mac.

It is a small web UI over the [`imsg`](https://github.com/openclaw/imsg) CLI: your
Mac keeps the messages and a local server reads them. Nothing is mirrored
anywhere and nothing is exposed to the Internet — the server answers on the Mac
itself and on your local network, and only for the addresses it was installed
with.

It is built for **one person on their own Mac**.

<p align="center">
  <img src="docs/screenshots/group.png" width="880"
       alt="A group conversation open in a browser: faces on the conversation row, a voice message with a progress bar, a reply quote, a tapback, and the composer.">
  <br><br>
  <img src="docs/screenshots/phone.png" width="300"
       alt="The same app at phone width: day separators, a picture in a bubble of its own, and the composer.">
</p>

<p align="center"><sub>Everything above is synthetic — from the preview in <code>scripts/demo-preview.mjs</code>.
Nothing in it was in anyone's conversation.</sub></p>

## Features

- **Conversations and history**, refreshed every 15 seconds, opening at the
  newest message and paging as you scroll
- **Pictures**, including Messages' cached thumbnail when the full image was
  never downloaded; click one to open it, with pinch and wheel zoom
- **Voice messages**, played in place
- **Contact pictures**, and a group wearing its members' faces
- **Replies and tapbacks**, with the quote as a way back to the message answered
- **Link cards**, from the preview Messages already stored
- **Sending** text, files and voice recordings you make in the browser
- **Notifications** for new messages, once you turn them on

Not supported: sending a reply or a tapback, read receipts, typing indicators,
search. The first two need imsg's bridge, which wants SIP disabled and code
injected into Messages; this project does not go there.

## Setting it up

You need a Mac that is signed into Messages and stays awake, with the Xcode
Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/MoomA-0750/imsg-web && cd imsg-web
./scripts/setup.sh
```

This fetches Node 24, builds the app and a patched `imsg`
([`imsg-patches/`](imsg-patches/)), and starts the server. It ends by printing
the addresses to open and a temporary password.

Then, once:

1. **Give Full Disk Access to the Node binary it names** (System Settings →
   Privacy & Security → Full Disk Access), and restart the server with the
   command it prints. Without this it cannot read your messages.
2. **Open one of the addresses** — `https://your-mac.local:8787`, or the Mac's
   IP address — on the Mac or on anything on the same Wi-Fi. Each device warns
   once that the certificate is not trusted: it is self-signed, made on your
   Mac. If the fingerprint matches what the installer printed, go on.
3. **Sign in with the temporary password.** You are asked to choose your own,
   and the temporary one stops working.

To update: `git pull && ./scripts/setup.sh`. The previous version is kept.

Options, all passed on to the installer: `--no-lan` serves only the Mac itself
(`https://localhost:8787`); `--send off` turns sending off.

### From outside your network

Use [Tailscale](https://tailscale.com). With it on both ends, the Mac's
Tailscale IP address works as it is. For a name with a trusted certificate,
serve it and install with that address:

```sh
tailscale serve --bg https+insecure://127.0.0.1:8787
./scripts/setup.sh --origin https://your-mac.your-tailnet.ts.net
```

## Using it

- **Send** with the round button, or Ctrl+Enter / ⌘+Enter. There is no
  confirmation step.
- **Record** with the microphone, which is where the send button is when there is
  nothing to send. What you record waits with the other attachments until you
  send it.
- **Attach** with `＋`. Several files go as several messages.
- **Open a picture** by clicking it; wheel, pinch or double click to zoom, and
  pull it down to close.
- **Jump to what a reply answers** by pressing its quote.
- **See the time of every message** by dragging the conversation to the left.
- **Turn on notifications** with the bell beside メッセージ.

Sending is on by default. `./scripts/setup.sh --send off` turns it off, and
`--send dry-run` validates everything without dispatching.

## Development

Put a dedicated Node **24.20.0** first in `PATH`, then:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:browser     # synthetic HTTPS, Chromium
```

Tests use synthetic data only and never run a real `imsg`. There is no fixture
anywhere in this repository that came from a real conversation.

`node scripts/demo-preview.mjs` runs the whole UI on made-up data at
`http://127.0.0.1:18787`, which is a good way to see it before installing
anything.

## More

- [`docs/security.md`](docs/security.md) — how it is kept safe, and what it is not defended against
- [`docs/behaviour.md`](docs/behaviour.md) — what the screen does not say: why a row is blank, why an image is missing, what a failed send means
- [`docs/operations.md`](docs/operations.md) — install, LaunchAgent, Serve, stop, update, and what to do when a send fails
- [`docs/architecture.md`](docs/architecture.md) — the read-only RPC contract, and how attachments, faces and audio are handled
- [`docs/real-data-findings.md`](docs/real-data-findings.md) — what real data proved, and disproved, about Messages' own storage
- [`imsg-patches/`](imsg-patches/) — the four patches, and how to build imsg with them

## Licence

MIT. See [LICENSE](LICENSE). `imsg` itself is MIT, © Peter Steinberger; the
patches here are changes to that source and carry its licence.
