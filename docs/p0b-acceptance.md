# P0b acceptance evidence

Date2026-09-08. Scope: authenticated **read-only internal slice**, not full P0/P1 or production rollout. Previous43 tests remain regression evidence; see `acceptance.md` for historical P0a results.

Final local run: Node24.20.0, **92 tests /10 files passed**, **9 HTTPS Chromium browser tests passed**, typecheck and production build passed. Runtime dependency audit:0 known vulnerabilities on this date. Known personal-identifier scan and manual source/log review found no real credentials/message fixtures; a full history/publication audit remains separate. Test execution required the approved unrestricted subprocess/socket environment, not relaxed assertions. Review dispositions: `p0b-reviews.md`.

| ID | Evidence and limits |
|---|---|
| B01 | Independent `tests/web-http.test.ts`: unauthorized/forged identity/Host/Origin/CSRF/JSON, private cookie properties, safe headers/error codes. Synthetic HTTPS Chromium tests verify the actual Secure HttpOnly cookie and text-only rendering |
| B02 | Independent `tests/web-auth.test.ts`: exact session/expiry/rate boundaries. HTTP held-read then revoke/rotate/expire/logout asserts401 and no body. Browser delayed read/logout and401 remove private state |
| B03 | `tests/owner-admin.test.ts`: actual private files/Unix socket, existing setup/symlink/mode refusal, hash-only persistence, revoke/rotate, duplicate ownership, simulated post-write fsync failure, dropped ACK, load-under-lock and pending rotation/stop race |
| B04 | `tests/live-source.test.ts`: actual temp inode replacement while fake child retains old file handle; bootstrap race, read-during-replace discard, old ID refusal, exact coalescing/1+32 bound, map2001, close-failure no new child, CLI termination failure propagated |
| B05 | `browser-tests/ui.spec.ts`: synthetic HTTPS, desktop and360px dark/keyboard, long/empty/null/error/limit1000, selected-chat and epoch reverse responses, logout/401, hidden-tab/focus polling. Synthetic screenshots manually inspected; no real message screenshot |
| B06 | Same archive hash on Intel/M1. Both temporary foreground servers: unauthorized401, static200, login200, capabilities/list/history200, revoke→401, confirmed source/admin shutdown. Table below. Not a browser-over-Tailscale or LaunchAgent test |
| B07 | Exact dependency lock, typecheck/build and original43 regressions plus added acceptance tests. Neutral design review4 lenses and independent intermediate/final code review; disposition in companion review record. Claude unavailable (organization access disabled), standalone packet supplied. Full release-history scan/license remains a publication gate |
| B08 | Owner/admin tests: duplicate startup preserves socket; normal stop permits restart; failed reader/HTTP stop retains marker; pending rotation blocks new owner, rotation stop deadline retains marker even after delayed write ends |

## Real-device evidence

Identical archive SHA256: `9b70e3ed25178d0e1da4804a2cef9c2a8345357bd69a9c23f56a362348ccdf18` (compiled app/static assets, locked package files, manual read-only HTTP probe). Node24.20.0 on both. Runtime-only install55 packages, scripts disabled, no global runtime changes.

| Environment | Chat rows | History rows of one chat | Read/typing capability | Probe elapsed | Revoked / closed |
|---|---:|---:|---|---:|---|
| Intel x64, imsg0.14.2, SIP-custom/bridge |24|50|available / available|3418ms|yes / confirmed|
| M1 arm64, imsg0.15.1, SIP enabled |28|50|unavailable / unavailable|2121ms|yes / confirmed|

Capability availability describes imsg, **not permission to invoke mutations in this Web UI**. No send/read-state mutation was performed. Different row counts reflect separate local Messages databases; no merging or cross-Mac ID reuse. Durations are one sample including auth and bootstrap, not p95 or a performance pass. Message values remained in probe memory and were not written to output, fixture files or screenshots.

`scripts/verify-readonly-http.mjs` is explicit manual testing only, guarded by `IMSG_WEB_LIVE_PROBE=readonly-approved`. It reads up to50 chats and50 messages of one chat. npm test never invokes real imsg. The probe prints bounded counts/timings/status and redacts failures. Browser test uses only a separate synthetic source and temporary certificate.

Tailscale Serve, LaunchAgent, SIP/TCC, Messages, global Node and existing watchers were not reconfigured. Temporary archives/runtimes/hash-only owner probe state remain until deliberate cleanup. The foreground HTTP/admin/imsg processes created by the probe were closed.

Final post-review archive SHA256: `84aed982d3719207ef29585321dbe655d92fd61fcb72c9ba1046049085e1d56a`. Repeated identical-archive probe passed on both: Intel24 chats/50 messages/3336ms, M1 28 chats/50 messages/2276ms; authentication, revoke401 and confirmed shutdown passed, send/read-state mutations0. This supersedes the initial archive for final implementation evidence; it does not expand the evidence to Tailscale/LaunchAgent.

## Remaining gates

See `p0b-operations.md`. No production URL is advertised; this does not assert a running service for the user. Full P0/P1 acceptance, real performance budgets, clean install/restore and observer coexistence remain incomplete. Sending is gated by the user's still-unresolved uncertain-operation recovery policy. No external publication/push.
