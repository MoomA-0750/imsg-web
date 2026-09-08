# P0c deployment acceptance — partial

## Latest checkpoint — 2026-09-09

M1 LaunchAgent access now works after the owner granted Full Disk Access to the dedicated Node executable. SIP remains enabled. Both temporary Agents are stopped following the performance gate below; no production Serve route or certificate was created. Earlier entries below are historical observations, not the current M1 blocker or release state.

Both Macs ran immutable release `a342425`, archive SHA256 `4579a40b2ad9cfd91bce29059b33aef4d5861bae59564663b9c26bdd59990816`, including the private-log and probe fixes. Server/UI remains the P0b implementation.

| C02 / C06 observation | Intel iMac | M1 Air |
|---|---:|---:|
| Actual chats / selected history messages | 24 / 50 | 28 / 50 |
| Backend read-state / typing capability | available / available | unavailable / unavailable |
| First API cycle after startup | 4,574 ms | 5,460 ms |
| Warm cycles contributing to p95 | 20 | 20 |
| Warm API-cycle p95 | 3,834 ms | 5,282 ms |
| Requested continuous polling duration | 1,800 s, completed | 1,800 s, completed |
| Observed sampled owned RSS maximum | 109 MiB | 53 MiB |
| RSS median at 5–15 min / 20–30 min | 105.242 / 107.250 MiB | 44.656 / 44.875 MiB |
| Defined RSS-growth flag | false | false |
| Preliminary combined performance guidance | **Not met** | **Not met** |

The API cycle is capabilities → chats → selected history, including body parsing, not browser rendering or a single endpoint. SIP capability observations do not authorize UI mutations. Both runs completed authenticated reads, rejected mutation routes and revoked test sessions with a subsequent401. A separate M1 verification also read28 chats/50 messages after the permission change.

Limits: fewer than50 chats existed; no50-chat coverage is claimed. The probe retained one selected opaque chat ID in memory per run but did not persist the20 raw cycle timings. Its nominal15-second polling and5-second RSS sampling share a serial loop, so reads add scheduling jitter and short-lived CLI children can be missed by RSS snapshots. The reported duration is the requested duration, not an independently saved actual elapsed time. These results establish a slow completed run, not full C06 acceptance or a continuous peak-memory bound. Foreground comparison remains unexecuted. Do not weaken the threshold or change cycle definitions retrospectively.

C04 ordinary cleanup: bootout of each exact temporary label completed; previously observed parent/RPC child PIDs were absent, port8787 had no listener, and private probe-state retained only owner.json (no lock/socket). Coarse wall-clock seconds were0 for both stops, not a subsecond benchmark. No active-read or forced-crash claim. Both Serve JSON outputs remained `{}`; the existing iMac watcher remained running. Runtime, releases, plists, logs and hash-only state were preserved. No message send/read-state mutation, OS reboot, automatic TCC edit or SIP change was performed.

Next decision: keep deployment stopped and authorize a bounded diagnostic comparison with per-stage timings and a corrected measurement recorder, or explicitly accept a limited trial with these delays after the remaining safety checks. No diagnosis or application performance fix has been validated. Static inspection identifies per-read RPC status and periodic CLI status as candidates only; do not remove DB-identity/permission checks or cache message bodies merely to meet the timing target.

Independent lifecycle-harness corrections and release-switch review did not complete because the assigned agents hit usage limits. Draft harnesses remain outside this release, unexecuted and unapproved. C03, active/crash C04, C05, complete C06 and C07 remain pending. Claude code approval is still unavailable; the existing neutral handoff packet remains available.

## Earlier checkpoint — 2026-09-08

2026-09-08. User approved the iMac-only Tailscale read-only deployment and temporary M1 Agent test, including CT hostname visibility, GUI-login dependency and trusted-local-machine/manual-recovery assumptions. No reboot, TCC edit, SIP change, Messages change, existing watcher change, push or public repository publication is authorized by this slice.

## Executed

| Condition | Evidence | Result |
|---|---|---|
| C01 generator syntax/bounds | tests/launch-agent.test.ts: direct argv, four env fields, lifecycle, XML escaping, invalid origin/path/root/permissions/symlink/collision, private exclusive outputs | Passed locally; actual plutil -lint succeeded on both Macs |
| C02 readonly boundary | Independent tests/p0c-boundary.test.ts + fixtures/p0c-imsg.mjs: both capability sets, all default argv/method/params, forbidden Web/client methods never dispatched | 5 new acceptance tests passed; lead inspected assertions |
| C02 actual iMac Agent | GUI user Agent, same dedicated Node24.20.0, imsg0.14.2, auth/read/caps/history, mutation routes404, revoke401 | 24 chats/50 messages, read/typing backend available, cycle4546ms. No body/key/IDs captured |
| C02 actual M1 Agent | macOS27.0 beta, dedicated Node24.20.0, imsg0.15.1, auth success, capabilities/chats503 DATABASE_UNAVAILABLE | Blocked; not read-success. Same dedicated Node over SSH doctor returned DBready and read/history/watch/close success, indicating a launch-context access difference. TCC diagnosis probable, not proven by reading its DB |
| C04 ordinary stop | Both temporary labels booted out; only owner.json remains in private state, socket/lock removed | Confirmed for these ordinary stops. Active-read/forced-crash matrix remains pending |
| C06 concurrency | Independent full-stack synthetic 2session×16 delayed polls→1 child read; request33 BUSY; one session's16 replies401; source1+32 queue, coalesce when full, timeout with late success discarded | Passed; not a real-device performance/soak result |

Both runtime dependency installations: 55 packages, audit56, known vulnerabilities0 at install. Same application archive on both devices SHA256 `9b6c8a36d6d677e15c965edf3790e3c853c58842228c9960a64d6004c60b8432`. This candidate archive predates the final probe-phase diagnostics/private-log creation fixes; those fixes are local only until a new immutable release is deployed. Server/UI source remains P0b commit9b64d36. No production Tailscale route was added.

Dedicated Node archives were rechecked against official v24.20.0 SHASUMS256: Darwin x64 `9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4`, Darwin arm64 `40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8`.

## Corrections and review scope

- Independent code reviewer found probe mutation-route checks omitted CSRF and would stop at403. Adopted: use the login's memory-only CSRF for expected404. Corrected archive used in both real Agent checks.
- Reviewer subsequently hit usage limits; no full independent code approval is claimed. Lead completed review and inspected the independent acceptance tests.
- Actual iMac launchd-created logs were0600; M1 logs were0644 despite plist Umask63. Both were inside an owner0700 directory, error logs empty and stdout only fixed36byte startup text. Adopted: generator creates missing0600 log placeholders and rejects unsafe existing logs. Tests check permissions, collision and non-truncation. Existing test logs preserved.
- Probe now reports only a fixed failed-stage label and keeps selected opaque chat ID in memory rather than selecting a possibly reordered first chat each cycle. No private values in errors.
- Claude's prior organization access restriction has no known resolution; no direct result. A neutral handoff packet is provided separately. Fable/routing/auth configuration not changed.

## Pending / not certified

C02 M1 LaunchAgent permission and subsequent read success; C03 actual Tailscale/HTTPS browser, external/LAN/v4/v6 reachability; C04 active/forced-crash Agent matrix; C05 path-switch rehearsal and later distinct-version rollback; C06 foreground comparison, warm20/30minute RSS; C07 owner final key/password-manager and phone handoff. Reboot/power-loss/manual lock recovery remains separately approved and untested. The current service is not ready for user login.

Temporary Agent labels are stopped on both Macs. Candidate runtime/releases/private hash state remain preserved on both; only iMac is intended for eventual permanent service. No automatic cleanup or stale-lock removal occurred.
