# P0c deployment acceptance — partial

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
