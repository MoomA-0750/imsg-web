# imsg-web contributor instructions

## Project boundary

This repository implements a single-owner, self-hosted iMessage Web UI. Reading
is the core; **sending** is approved and shipped as a **separate, off-by-default**
path (`src/server/send-service.ts`, `src/server/rpc/send-client.ts`). Read-state
changes and typing are still not approved.

- Sending is its own path. It never reuses the read-only RPC client or its
  method allowlist; the read allowlist stays `status`, `chats.list`,
  `messages.history`, `watch.subscribe`, `watch.unsubscribe`. The send path is
  `send` only, over the AppleScript transport (no IMCore injection, no SIP
  change). Not `send.tracked`: it requires the bridge transport. imsg's error
  reports whether a send started, so a pre-dispatch failure stays distinct from
  an ambiguous one. An attachment is uploaded first to `POST /api/uploads`: the
  only binary route, `application/octet-stream` only (never a form encoding,
  which a page could submit cross-site), streamed straight to a private 0700
  directory, bounded, and deleted after the send. Everything else stays
  JSON-only. imsg takes one file per send, so several attachments are sent as
  several messages, stopping at the first that does not go. A recording is the
  one upload the server alters: `?voice=1` re-encodes it from the PCM a browser
  can write to AAC, with `afconvert`, and a failure there sends the PCM instead.
  `img-src` and `media-src` allow `blob:` so a chosen file or a recording can be
  played back locally before sending; a blob URL is minted by the page for its
  own data and admits no third-party content. `Permissions-Policy` closes every
  device to the page except the microphone, which recording needs. **Do not
  perform a real send while working on this** without the owner's approval each
  time — that the product sends by default is not permission for an agent to
  send one. The composer sends immediately (no confirmation step) at the owner's
  request; one send at a time and honest reporting are what remain.
- Keep UI code replaceable. Read rules and RPC/API contracts must not be derived
  from screen structure or component state.
- Do not weaken authentication, exact Origin/Host checks, Secure cookies,
  loopback-only binding, the read RPC method allowlist, the send method
  restriction, CSRF, or response bounds, including for development or previews.
- Never log or commit message text, recipients, chat/message IDs, owner keys,
  cookies, local database paths, raw RPC responses or private machine inventory.
- Do not change SIP/TCC, request permissions, launch or repair Messages.app,
  replace installed imsg/Node, touch the owner's other message-bridge system
  (its agents, processes or lock files), configure Tailscale Serve/Funnel,
  install LaunchAgents, start production or push without the owner's approval.
- `npm run doctor` may launch or repair Messages.app through upstream
  `imsg status`. Do not use it as a harmless check.
- Never delete lock or socket files automatically, and never kill `imsg`
  processes broadly. If cleanup is uncertain, stop and ask.

## Runtime and verification

Use a dedicated Node **24.20.0** first in `PATH`; never replace the system Node.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:browser
```

Run checks proportionate to the change. Tests use synthetic data only. The
tailnet demo (`docs/demo-preview.md`) is synthetic HTTP; never adapt it into
production or enter a real owner key.

## Keep it proportionate

This is a personal read-only tool. Prefer the simplest change that keeps the
boundaries above. Settle routine questions with a sensible default and say so;
bring the owner only real decisions. Do not build measurement or review
machinery unless the owner asks for it.

## Records

- `STATUS.md`: current state and next action, kept short.
- `docs/`: public-safe design, operations and findings. Fix stale claims when
  found.
- Machine names, paths and leftover state belong in the owner's private notes,
  not in this repository.

Work in scoped commits. Preserve unrelated changes. Never push unless the owner
asks after seeing what will be published.
