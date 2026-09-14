# imsg-web

A single-owner, self-hosted, **read-only** iMessage web UI for macOS, built on
the [`imsg`](https://github.com/openclaw/imsg) CLI. Each Mac runs its own
instance, reached over Tailscale and protected by an owner key.

Implemented: owner login, sessions and key rotation; conversation list and
history with 15-second refresh; images from attachments that are on the Mac,
or Messages' cached thumbnail when the image was never downloaded;
link cards from the preview Messages stored; a responsive UI. Not implemented:
sending, read-state changes, typing, search, video and other attachment types,
profile pictures.

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
