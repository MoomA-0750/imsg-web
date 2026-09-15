# imsg-web

A single-owner, self-hosted iMessage web UI for macOS, built on the
[`imsg`](https://github.com/openclaw/imsg) CLI. Each Mac runs its own instance,
reached over Tailscale and protected by an owner key. Reading is the core;
sending is a separate path that is off unless configured.

Implemented: owner login, sessions and key rotation; conversation list and
history with 15-second refresh, opening on the newest message and paging as the
owner scrolls; images from attachments that are on the Mac,
or Messages' cached thumbnail when the image was never downloaded;
link cards from the preview Messages stored; the message a reply answers and
the tapbacks on a message; sending text and attachments (off by default; see
`docs/operations.md`); a responsive UI. Not implemented: sending replies or
tapbacks (imsg needs its bridge transport, which wants SIP off and code
injected into Messages), read-state changes, typing, search, profile pictures.

## What the screen does not say

Behaviour worth knowing, kept out of the UI so it does not explain itself at the
owner every time:

- **Attachments go one per message.** imsg sends a single file per send, so ten
  files arrive as ten messages, in the order they were chosen, with any text on
  the first. A batch stops at the first that does not go and says how far it got.
- **Sending is immediate** — no confirmation. Ctrl+Enter or ⌘+Enter sends, and so
  does the round button. The field is labelled with the service it will send
  over, `iMessage` or `SMS`, and nothing else.
- **A blue bubble means iMessage, green means anything else** (SMS, RCS, or a
  service imsg did not report), the way Messages colours them. imsg reports the
  service per conversation, so a conversation that fell back for one message
  still reads as one colour.
- **A conversation list row shows its newest message**, read separately from the
  list itself; a row still blank has not been read yet, which is not the same as
  having no messages.
- **Reading refreshes itself** every 15 seconds and whenever the tab is returned
  to. There is no refresh button. A read that fails offers 再試行.
- **Scrolling pages both lists** — up through a conversation, down through the
  list — and stops when a read returns fewer rows than it asked for.

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

Tests use synthetic data only and never run a real `imsg`.

`npm run doctor` calls upstream `imsg status`, which may launch or repair
Messages.app. Do not use it as a harmless check.

## Running on a Mac

- `imsg-patches/` — the patched `imsg` build the app requires
- `docs/operations.md` — install, LaunchAgent, Serve, stop, update
- `docs/real-data-findings.md` — what was confirmed against real data
- `docs/architecture.md` — the read-only RPC client contract
- `docs/demo-preview.md` — synthetic preview for trying the UI from another device

No messages are mirrored, nothing is exposed to the public Internet, and SIP/TCC
settings are never changed by this project.

The repository is local and unpublished; no license is granted yet.
