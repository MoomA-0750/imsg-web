# Custom read preflight review and evidence

## Review dispositions

Two independent reviewers received only `custom-read-preflight-review.md`; neither edited code or accessed Macs. Lead implements the runner because lifecycle and confidentiality checks cross its entire execution path.

| Finding | Disposition and reason |
|---|---|
| Valid response can hide later errors | Adopt. Success is provisional until direct child close, code 0, no signal or escalation, exactly one complete frame, no stderr/trailing bytes. Tests inject each failure after a valid response. |
| Payload/framing too permissive | Adopt. JSON-RPC 2.0, exact string ID, only envelope keys jsonrpc/id/result, object result, 0–1 object rows with positive safe integer id, optional string contact_name. Blank/duplicate/partial frames fail. Other chat fields are not validated. |
| EOF/parent loss prerequisite missing | Adopt as a live gate. Both pinned RPCServer loops stop admission on EOF, cancel subscriptions, then wait for accepted requests to drain. EOF alone cannot terminate a stuck accepted request. Parent signal cleanup is implemented; SIGKILL/host failure cannot be guaranteed. Parent-loss synthetic tests remain required. |
| KILL not proven by close alone | Adopt. Resistant fixture has an indefinitely live timer and ignores TERM; require actual SIGKILL and bounded completion. |
| Confidentiality test too narrow | Adopt. Error fixtures include markers and summary checks. Full subprocess CLI output checks remain to be completed before live execution. |
| Authorization audit beyond startup | Adopt as a live gate. Both exact RpcCommand implementations use non-TTY skipIfNotDetermined. Production ContactResolver.create has one requestAccess call, gated by requestIfNeeded (0.15.1 also requires non-SSH). Catalog snapshot rejects unreadable sources before loading; native loader enumerates Contacts, and 0.15.1 AddressBook fallback uses read-only SQLite. These facts rule out explicit requestAccess on this route, not arbitrary OS UI behavior during a grant race. No desktop prompt observer is available; do not equate absence of RPC error with absence of a prompt. Final review must assess this boundary before live execution. |
| Spawn/EPIPE/signal races | Adopt. Idempotent stop/final verdict; handle child and all stdio errors, SIGINT/TERM/HUP. Synthetic spawn failure, early exit, repeated interruption covered. |

## Verification in progress

2026-09-10: 18 synthetic checks passed using Node 24.20.0 outside the sandbox. Inside the sandbox, nested Node execution silently produced no stdout even for a minimal hello example; the approved unrestricted run resolved that test-environment discrepancy. This does not provide Mac runtime evidence.

Build-input manifests cover tracked Sources, Tests, and Package.swift. M1 source inputs all match the final 0.15.1 candidate. Package.resolved SHA256: `be55852d84140bb12cbf4c58bb67f8260337878837e80d6ddeef41f259a3ae00`. Debug executable SHA256: `cad81d4b181332dfb244c07ef8e87931210850cba6cb13fa30c6afc690ae9bef`; arm64, ad-hoc signature, no TeamIdentifier. Intel comparison found only the test's bounded waits were missing remotely; copied the committed bounded-wait test to its exact target. Reverification pending.

## Final preflight gates

Independent code re-review found two further defects: cleanup timeout left parent handles live, and executable digest was absent from the summary. Both adopted: destroy pipes/unref on cleanup failure (still closed:false), include verified SHA256. Added a real subprocess external deadline test, exact error-category assertions, EOF-accumulated request assertion, more artifact checks, raw-output marker tests, and parent SIGKILL/cooperative-child EOF test. Re-review found no remaining concrete implementation blocker. One other review attempt exhausted its usage limit and provides no completed result.

Lead source audit: both exact RpcCommand startup factories call ContactResolver.create with non-TTY skipIfNotDetermined. Production requestAccess can only execute under requestIfNeeded; the other create overload is a test seam. Native catalog loading checks authorized before enumerateContacts. Version 0.15.1 additionally routes SSH fallback through AddressBook read-only SQLite; it adds no authorization-request API. Both MessageStore initializers open SQLite read-only; chats.list invokes database/contacts payload paths without invoking the mutation/bridge closures stored in RPCServer. Therefore no explicit authorization request is reachable for this fixed request. This is the adopted audit boundary, not a guarantee that OS UI cannot occur during a concurrent permission change. There is no desktop prompt observer. A reported prompt, access error, timeout, or cleanup failure stops further live attempts for that target.

Both versions' EOF paths stop admission, cancel subscriptions, and drain accepted work. The supervisor enforces a deadline while alive; parent SIGKILL cannot guarantee stopping a stuck accepted request. Synthetic parent loss confirms EOF delivery to a cooperative child, not an impossible unconditional termination guarantee. No long-lived subscription is requested.

Intel final tracked inputs now match and all six focused native candidate tests pass, including bounded waits. Package.resolved SHA256 `119d9373e83738fb78819106065d119fcb53b262a77a97c1c087bf01aba273e9`; debug executable `f1433d9e4e6b6da11157355c9621f8ed0a8bcbe079f2e8c3c620248d4dd38c22`, x86_64 ad-hoc signature/no TeamIdentifier. M1 supervisor synthetic tests: 21 passed. Intel: 20 passed, one fixture's 100ms startup allowance expired before it created the pipe-retaining descendant; increased only that fixture's startup allowance to 1000ms, retaining an external 2500ms parent deadline and a 3000ms bounded descendant.

Performance measurement and C06 acceptance remain separate from this one-chat access preflight.

## Live access result — 2026-09-10

Intel's revised deadline fixture passed. A first CLI invocation did not enter main because macOS canonicalizes /tmp to /private/tmp; it produced no summary and did not launch a candidate. Fixed entrypoint canonicalization and added a symlink regression test (passed locally and on Intel). Final local synthetic suite: 22 passed. Final runner SHA256: `613112f0b90912ec21bf575607e67f15ce400b0572f27f0a12e7169b35ee291d`.

| Target | Outcome | Rows / named rows | Normal close | TERM / KILL | Elapsed including startup/exit |
|---|---|---|---|---|---|
| Intel 0.14.2 candidate | ok | 1 / 0 | exit 0 | neither | 288 ms |
| M1 0.15.1 candidate | ok | 1 / 1 | exit 0 | neither | 1932 ms |

Both summaries identify the exact candidate digests above. No raw chat fields or stderr were retained or printed. These are single debug-build SSH reads, not a controlled performance comparison, a claim of equivalent Contacts permissions, or C06 acceptance. Intel's absent optional name is inconclusive: the selected chat may be a group, unnamed contact, or unavailable Contacts source. No permission was added, and no prompt is asserted observed or absent at the desktop.

Next work: matched baseline/candidate release builds and bounded reads under equivalent runtime/source conditions, with source-availability differences distinguished from batching effects. Current C06 remains unaccepted. No candidate installed or integrated into the application. A separate review attempt hit an explicit account usage limit; preserve this checkpoint before starting that larger build/measurement phase. Claude fallback packet remains available; no direct Claude result exists.
