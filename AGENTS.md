# imsg-web contributor instructions

## Project boundary

This repository implements a single-owner, self-hosted iMessage Web UI. The
current integrated product is an authenticated, read-only P0 slice. Sending,
read-state mutation, typing and production deployment are not currently approved.

- Keep UI code replaceable. Domain/read rules and RPC/API contracts must not be
  derived from temporary screen structure or component state.
- Do not weaken authentication, exact Origin/Host checks, Secure-cookie behavior,
  loopback-only production binding, RPC method allowlists or response bounds to
  simplify development or previews.
- Never log or commit message text, recipients, chat/message IDs, owner keys,
  cookies, local database paths, raw RPC responses or private machine inventory.
- Do not change SIP/TCC, request permissions, launch/repair Messages.app, replace
  installed imsg/Node, modify unrelated watchers, configure Tailscale Serve/Funnel,
  install LaunchAgents or push/publish without explicit owner approval.
- `npm run doctor` is not a no-launch preflight: upstream CLI status may launch or
  repair Messages.app. Historical `scripts/diagnose-performance.mjs` is pinned to
  release a342425 and its old CLI-injected workload; do not reuse or repoint it.
- Production stays stopped until current STATUS.md gates and owner approval say
  otherwise. Synthetic/nonlaunch success is never live admission or C06 success.

## Runtime and verification

Use a dedicated Node **24.20.0** by putting its `bin` first in `PATH`; never replace
the system/global runtime. Verify downloaded archives against Node's official
`SHASUMS256.txt`. Install from the exact lock without lifecycle scripts:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:nonlaunch
npm run test:browser
```

Run checks proportionate to the change. `test:nonlaunch` builds fresh output and
runs synthetic process/socket tests serially. It does not run imsg or access live
Messages data. Browser tests use synthetic HTTPS. The separate tailnet demo is
synthetic HTTP only; never adapt it into production or enter a real owner key.

Before native/Mac work, read STATUS.md and the linked admission/review records.
Use immutable private paths, direct absolute executables and exact-child handles.
Do not trust numeric PIDs alone, process names, `launchctl` return alone, or a
generated manifest digest as provenance. Preserve uncertain ownership/cleanup as
failure; never delete stale lock/socket state automatically.

## Records and review

- `STATUS.md`: concise current truth and next action.
- `docs/`: public-safe design, review packets, decisions, tests and sanitized
  evidence. Update stale claims as soon as they are discovered.
- The owner's private Vault project note: machine names, paths, retained temporary
  state, private operational context and handoff inventory. Do not copy those into
  this repository.

For safety-critical changes, write a neutral packet with requirements, current
evidence, missing gates and exact review scope. Use a fresh one-off reviewer
session; provide only selected public-safe material and no live data/secrets.
Record every finding as adopted/rejected/deferred with reason. A review is not a
test, and neither is live approval. After adopted fixes, run focused re-review.

Work in scoped commits. Preserve unrelated dirty files. Never push unless the
owner explicitly asks after reviewing what will be published.
