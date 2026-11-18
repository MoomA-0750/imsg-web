# Handoff — 2026-11-18

The current state, overwritten at each stopping point. Not a diary: history and
decisions go to `docs/decisions.md`, open threads about the running service to
`STATUS.md`.

## Purpose

A single-owner, self-hosted iMessage Web UI (read first, sending off by
default). See `README.md` and `AGENTS.md`.

## Where things are

- **`main` = `origin/main`** (pushed 2026-11-18 with the owner's approval). It
  contains the kasane-trial merge `02c89ea`: the web UI moved to kasane
  (personal theme, `k-*` components), with kasane's CSS copied into
  `web/vendor/kasane/` and no kasane package dependency.
- **The M1 runs `7fc799f`** (the kasane UI), installed 2026-11-18 by
  `scripts/setup.sh --origin <tailnet name>` from a fresh copy of `main` (sent
  as a git bundle; the Mac had no checkout left). Before that, the same
  build steps were run alone on the Mac: `npm ci --ignore-scripts`, typecheck,
  build and the patched imsg all passed. After the install the server listened
  within about 5 s, the error log had nothing new, and the sign-in page came up
  over the tailnet styled by kasane. Signing in and reading real chats were not
  checked by the agent (no owner password); the owner should look on the
  iPhone.
- **Rollback: `cc50f00`.** Its release and its plist (set aside in the base as
  `local.imsg-web.plist.cc50f00`) are kept; `prune` removed `8ac2fe9`. To roll
  back on the Mac:
  `launchctl bootout gui/$(id -u)/local.imsg-web`, move
  `<base>/local.imsg-web.plist.cc50f00` to
  `~/Library/LaunchAgents/local.imsg-web.plist`, then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.imsg-web.plist`.
  Same Node runtime, so Full Disk Access is unaffected.
- The `kasane-trial` branch is fully merged into `main`; it has no upstream and
  can be deleted when convenient.

## Left to do

1. Owner: sign in on the iPhone and use the kasane UI for a while; roll back
   (above) if something is wrong.
2. One-off: `tests/image-convert.test.ts` "converts to JPEG for a browser that
   cannot draw HEIC…" failed once in a full `--maxWorkers=1` run on the Linux PC
   and then passed 5 times alone and twice in full runs. If it fails again, keep
   the output and look at it.
3. Small, optional: the sign-in page has no favicon (404 in the console).

## First thing for the next session

`git pull`, `npm ci --ignore-scripts`, then read `STATUS.md`.

## Waiting on the owner

- How the kasane UI feels in daily use on the M1.

## Careful

- All of `AGENTS.md` applies: no real send, no SIP/TCC, Messages.app, the other
  bridge system, lock files or broad `imsg` kills; no push, production start or
  Serve change without the owner's approval.
- `npm run doctor` may launch or repair Messages.app; it is not a harmless check.
- The Mac keeps no checkout: the deploy copy lived in a temp directory. The
  next deploy needs a fresh copy (`git clone` from GitHub now works, since
  `main` is pushed) and builds imsg from scratch (a few minutes).
- This Linux PC has Node 22, not the required 24.20.0; tests with tight
  subprocess timing are the first to break here.

## Where to read more

`STATUS.md` (service state and open threads), `docs/decisions.md`,
`docs/operations.md` (install and deploy), `docs/api.md`, `docs/security.md`,
UI rules in kasane's `DESIGN.md` (see `AGENTS.md`).
