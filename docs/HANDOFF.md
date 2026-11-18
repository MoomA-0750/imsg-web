# Handoff — 2026-11-19

The current state, overwritten at each stopping point. Not a diary: history and
decisions go to `docs/decisions.md`, open threads about the running service to
`STATUS.md`.

## Purpose

A single-owner, self-hosted iMessage Web UI (read first, sending off by
default). See `README.md` and `AGENTS.md`.

## Where things are

- **`main` = `origin/main`** (pushed 2026-11-19 with the owner's approval).
- **The M1 runs `b177df0`** since 2026-11-19: the kasane UI plus a favicon and
  apple-touch-icon (`f087169`; the seed colour `#1f5fa8` with a white speech
  bubble). Installed by `scripts/setup.sh --origin <tailnet name>` from a fresh
  copy of `main` sent as a git bundle into a temp directory on the Mac (removed
  afterwards). Checked over the tailnet: `/favicon.svg` and
  `/apple-touch-icon.png` answer 200 (both 404 before), the sign-in page links
  both, a browser loads the icon and no 404 is left in the console (the one
  401 is the signed-out session probe). The error log has nothing new.
  Signing in was not checked by the agent (no owner password).
- **Rollback: `7fc799f`.** Its release and plist
  (`<base>/local.imsg-web.plist.7fc799f`) are kept; `prune` removed `cc50f00`.
  To roll back on the Mac: `launchctl bootout gui/$(id -u)/local.imsg-web`,
  move `<base>/local.imsg-web.plist.7fc799f` to
  `~/Library/LaunchAgents/local.imsg-web.plist`, then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.imsg-web.plist`.
  Same Node runtime, so Full Disk Access is unaffected.
- The icons: `web/public/favicon.svg` (Vite copies `web/public` to the build
  root); the PNG is drawn from `scripts/icons/apple-touch-icon.svg` by
  `node scripts/icons/render.mjs`. The server serves only those two names.
- The `kasane-trial` branch is fully merged into `main`; it has no upstream and
  can be deleted when convenient.

## Left to do

1. Owner: sign in on the iPhone and use the kasane UI for a while; roll back
   (above) if something is wrong.
2. One-off: `tests/image-convert.test.ts` "converts to JPEG for a browser that
   cannot draw HEIC…" failed once in a full `--maxWorkers=1` run on the Linux PC
   and then passed 5 times alone and twice in full runs. If it fails again, keep
   the output and look at it.

## First thing for the next session

`git pull`, `npm ci --ignore-scripts`, then read `STATUS.md`.

## Waiting on the owner

- How the kasane UI feels in daily use on the M1, and whether the new icon
  (tab and "Add to Home Screen") looks right.

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
