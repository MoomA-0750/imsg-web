# Acceptance evidence

Date: 2026-09-07. Scope: **P0a**, not P0/P1 or a usable Web UI.

| ID | Expected result | Evidence/status |
|---|---|---|
| A01 | Same JS build on SIP-enabled arm64 and bridge-enabled x64; safe status/chats/history/watch diagnostics | Passed on both real Macs, Node24.20.0; table below. Doctor synthetic privacy and denied/empty cases also pass |
| A02 | Correct framing/ID mapping, 4 active+32 queued, request37 immediate rejection; no mutation dispatch | Passed: `tests/rpc.test.ts`, subprocess fault injection; exact active/queued/dispatch assertions |
| A03 | State/reason matches fixed capability table; independent DB reads survive CLI/bridge/contacts failure | Passed: `tests/capabilities.test.ts`, fixed truth-table assertions, both real snapshots |
| A04 | timeout/abort closes only own child; no subsequent dispatch; clean shutdown bounded | Passed: subprocess SIGTERM-ignore and inherited-pipe tests; `tests/rpc-lifecycle.test.ts` and `tests/cli-status.test.ts` directly assert pipe destruction/unref on hard deadline |
| A05 | Explicit partial scope, no private fixture values, review/evidence mapping | README, architecture, this file, reviews; source/private-identifier scan checked; publication/full-history release scan still a future gate |

`tests/adapter.test.ts` separately checks invalid parameters before dispatch, cross-chat result rejection, single pending subscription, and close on malformed subscription response.

Evidence classes: **synthetic fault injection**, **real-derived structure with synthetic values**, **real device**. These must not be conflated. A valid watch subscription is not proof of message delivery. No new real messages are sent during P0a.

## Final run

2026-09-07: Node24.20.0, TypeScript5.9.3, Vitest5.0.0, 6 test files / **43 passed**. `npm run typecheck` and `npm run build` passed. npm install audit reported 0 known vulnerabilities for the locked dependency set on this date. Runtime has no npm dependencies.

The host's restricted execution environment silently exited Node subprocesses without stdout, including a minimal standalone spawn reproduction. The same tests passed outside that restriction. This was not handled by relaxing assertions or changing production read semantics. The unrestricted synthetic test run is the reported evidence.

Reviewed JS bundle SHA-256: `b864a108d2244f903a521d5637e7e3b593e851d320449e686fd43b4755b43e34`. Identical on both target Macs. Node archives were checked against official SHA-256 before extraction. Runtime installed only to temporary probe directories, not global PATH or a LaunchAgent.

| Real environment | RPC status | CLI status | Chats (1) | History (1) | Subscribe / unsubscribe | Shutdown |
|---|---:|---:|---:|---:|---:|---:|
| Intel x64, SIP-custom/bridge ready, imsg0.14.2 | 423ms | 608ms | 77ms | 31ms | 1 / 1ms | 5ms |
| Apple Silicon arm64, SIP enabled/no bridge, imsg0.15.1 | 171ms | 144ms | 22ms | 33ms | 1 / 3ms | 6ms |

All table checks passed; one sample each, **not p95 or an application performance benchmark**. Contacts unavailable on Intel did not block DB reads. SIP enabled on arm64 correctly reported read/typing unavailable. No events arrived in the short observation window; `deliveryVerified=false` on both. No authentication, production service, send, or cross-client delivery claim follows from this table.

## Remaining gates

- Overall AC01–15 remain incomplete. A01–05 here cover only a subset of AC01/02/04/10/15.
- Production LaunchAgent permissions, Tailscale and auth, UI, operation ledger, send recovery, attachments, and performance baselines are not tested by doctor.
- Existing watcher concurrent mutation safety and cross-client delivery are not proven by process survival or a successful subscription.
- Past direct-imsg self-send smoke tests do not certify the unimplemented Web UI.
