# Handoff — 2026-11-18

The current state, overwritten at each stopping point. Not a diary: history and
decisions go to `docs/decisions.md`, open threads about the running service to
`STATUS.md`.

## Purpose

A single-owner, self-hosted iMessage Web UI (read first, sending off by
default). See `README.md` and `AGENTS.md`.

## Where things are

- **`main` = `origin/main` at `02c89ea`** (plus this handoff commit, local only
  until the owner asks for a push). It contains:
  - `cc50f00` body `min-height: 100dvh`.
  - `5c9a215` rpc subprocess tests given time for the fixture child to start
    (see `docs/decisions.md`). With it, `npm test -- --maxWorkers=1` passes
    250/250 on the Linux PC.
  - `02c89ea` the kasane-trial merge: the web UI moved to kasane (personal theme,
    `k-*` components). kasane's CSS is copied into `web/vendor/kasane/` and the
    kasane package dependency was dropped, so `setup.sh` can build on a Mac that
    has no kasane checkout.
- **The M1 runs `cc50f00`** (installed 2026-11-16 with `setup.sh`; the previous
  release `8ac2fe9` is kept as the rollback). The kasane UI is **not** deployed.
- The `kasane-trial` branch is fully merged into `main`; it has no upstream and
  can be deleted when convenient.

## Left to do

1. Confirm `main` (with `web/vendor/kasane/`) builds and runs on the Mac through
   `setup.sh`, then deploy it — only with the owner's approval.
2. Push the local handoff commit when the owner asks.
3. One-off: `tests/image-convert.test.ts` "converts to JPEG for a browser that
   cannot draw HEIC…" failed once in a full `--maxWorkers=1` run on the Linux PC
   and then passed 5 times alone and twice in full runs. The error was not
   captured. If it fails again, keep the output and look at it.

## First thing for the next session

After checking out `main`: `git pull` and `npm ci --ignore-scripts` (the
dependencies changed in `02c89ea`). Then read `STATUS.md`.

## Waiting on the owner

- Whether and when to deploy the kasane UI (`main` after `02c89ea`) to the M1.
- Push of the local handoff commit.

## Careful

- All of `AGENTS.md` applies: no real send, no SIP/TCC, Messages.app, the other
  bridge system, lock files or broad `imsg` kills; no push, production start or
  Serve change without the owner's approval.
- `npm run doctor` may launch or repair Messages.app; it is not a harmless check.
- This Linux PC has Node 22, not the required 24.20.0. Node starts in about
  110 ms here versus about 36 ms on the Mac, so tests with tight subprocess
  timing are the first to break here.

## Where to read more

`STATUS.md` (service state and open threads), `docs/decisions.md`,
`docs/operations.md` (install and deploy), `docs/api.md`, `docs/security.md`,
UI rules in kasane's `DESIGN.md` (see `AGENTS.md`).
