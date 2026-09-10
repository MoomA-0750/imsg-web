# Non-launch API measurement preparation — 2026-09-10

Implemented `scripts/nonlaunch-api-workload.mjs`, a transport-free cycle helper.
It does not import the application, create a process/socket, authenticate, deploy,
or run on import. Production code and executable admission remain unchanged.

Each session issues sequential capabilities, chats(limit=50), then first-chat
history(limit=50) GETs. The selected opaque ID is retained within that session,
even if ordering changes. Missing selected chat, changing epoch, invalid DTO,
non-200 response, or transport failure makes the session terminal. Concurrent
calls are rejected without issuing requests. Advanced capability states must
remain unknown/STATUS_PROBE_DISABLED. Output is assembled from fixed categories,
counts, booleans and timings, never response/error spreads. Empty history is
explicitly marked; every result has gateMeasurement:false.

This is a new labeled workload, not a repointing of the historical a342425
diagnostic. It preserves first-chat selection, but adds stricter validation and
does not include the old CLI probe. No historical timing is relabeled.

## Remaining integration gates

- Independently review this helper and the complete supervisor before live use.
  Only lead source/test review has occurred for this helper.
- Supply authenticated GET transport with response-size and absolute deadlines,
  abort propagation, no response logging, and a trusted loopback destination.
  The helper deliberately does not implement cancellation by Promise.race:
  abandoning an unresolved transport must not imply that work has stopped.
- Pin a new built application artifact and exact Node runtime. Audit both pinned
  upstream RPC initializers/status paths. Do not use doctor or CLI status.
- Verify custom binary digest/source and exact-owned child lifecycle, including
  LiveSource's bootstrap close/reopen. Keep production executable rules intact.
- Own isolated state, authentication, session revocation, and confirmed shutdown
  on success, failures, signals and deadline. Never infer termination from a
  client's logical closed flag alone.
- Prove same raw chat target and ordered payload/name parity across arms through
  separately reviewed in-memory RPC observation. Web IDs and epochs are random
  per source; do not compare them across sessions or strip IDs and claim identity
  equality. This helper makes no cross-arm equivalence claim.
- Add scheduling, same-host counterbalancing, stage attribution and complete C06
  20-sample/30-minute resource/lifecycle checks; short helper tests are not C06.

## Verification

`node --test scripts/nonlaunch-api-workload.test.mjs` passes on available Node
22.23.1 and 24.19.0 (six cases). Covers sequential endpoint order, stable target,
timing, epoch/target/HTTP failure, malformed DTOs, empty history, concurrency,
redacted transport exceptions, fresh-arm IDs and invalid clocks. No sleeps,
network, Mac access or live data are involved. Exact Node 24.20.0 remains pending.
Production/browser suites were not rerun for this additive standalone helper.

## Authenticated route integration — 2026-09-10 follow-up

Added `tests/nonlaunch-api-workload.test.ts` to run the actual helper through
`createApp` routing, authentication and response serialization using synthetic
`ReadSource` data and in-process HTTP injection. Four cases cover a successful
cycle followed by CSRF-protected logout, pre-request revocation with no source
dispatch, revocation while history is pending, and a redacted upstream failure.
Failures remain terminal and never count as measurements. Fixtures revoke all
sessions and await application/source closure in teardown, including failed tests.

The full application suite now passes 127 tests on available Node 24.19.0;
the six standalone helper tests also pass. Typecheck passes on Node 22.23.1,
and `git diff --check` is clean. No production source or UI changed. Browser,
build, exact Node 24.20.0, and Mac checks were not rerun in this follow-up.

This verifies compatibility with real API handlers, not a live transport or
process supervisor: no socket, RPC child, owner state file, or Mac was created.
In particular, the fixture explicitly closes its source; `createApp.close()`
alone is not asserted to own or terminate RPC children. Bounded authenticated
loopback transport and exact-owned process cleanup remain the next integration
work, followed by the admission/parity/review gates above. No independent review
or C06 acceptance is claimed.

## Bounded loopback transport — 2026-09-10 follow-up

Added `scripts/nonlaunch-api-transport.mjs`, an experimental authenticated GET
transport consumed by the existing workload. It connects only to literal
127.0.0.1 at a supplied port, sends a canonical configured HTTPS origin as
Host/Origin and a strictly shaped session cookie, and accepts only the three
workload routes (history IDs use the application's 43-character token shape).
It does not follow redirects, use proxies, retry, log responses, authenticate
an owner, or run on import. Each request uses a separate nonpersistent socket.

The request deadline includes headers and body, is not reset by incoming bytes,
and is checked around JSON parsing. Responses are limited to at most 4 MiB and
16 KiB headers; malformed UTF-8/JSON, encoded/non-JSON content, non-200 status,
truncation, and abort fail with a fixed error. Failed transports are terminal;
overlapping calls are rejected without issuing another request. Failure destroys
the local request/response/socket. Settlement waits for request and socket close;
`close()` prevents future requests and waits for active local transport teardown.

**Local socket closure does not mean upstream work stopped.** The application may
still await an RPC after a client disconnect. This is not RPC cancellation or an
owned-process exit guarantee, and it does not replace supervisor cleanup. A
loopback port also does not prove listener ownership: a reviewed supervisor must
establish that before handing a credential to this transport. Login, revocation,
artifact/runtime admission, signals, whole-run deadlines and source/child exit
confirmation remain outside this helper. No live use is approved by these tests.

Seven standalone synthetic HTTP tests pass on Node 24.19.0, including continuous
body bytes, no response headers, abort/close, malformed/oversized responses,
redirect rejection and exact request headers. The sandbox initially denied
loopback listening (EPERM); these tests passed after explicit execution approval.
One additional full-workload test now runs against the actual authenticated app
over loopback, then verifies revoked-session rejection. Full application suite:
128 passed on Node 24.19.0; typecheck passed on Node 22.23.1. Production sources,
UI and installed Mac artifacts remain unchanged. Exact Node 24.20.0, browser/build,
independent review and Mac performance checks were not run in this follow-up.

Run the standalone suite with `node scripts/nonlaunch-api-transport.test.mjs`.
The earlier remaining-gates list now requires supervisor integration/review of
this transport rather than its initial implementation. Next: exact-owned
application/RPC lifecycle and listener admission, with failure-path tests.

## Native source lifecycle evidence — 2026-09-10 follow-up

Added `tests/nonlaunch-source-lifecycle.test.ts` and a synthetic Node RPC child
fixture. Unlike earlier fake-source route tests, these use production LiveSource
and ReadonlyRpcClient with real subprocesses. The test-local spawn wrapper keeps
the exact returned ChildProcess handles and registers close observation before
returning each handle. It does not discover or signal arbitrary numeric PIDs.
The fixture uses a temporary synthetic file only, not Messages DB or imsg.

Three passing cases establish:

- Bootstrap child `close` occurs before usable-reader spawn. Both children exit
  normally for a successful capabilities/chats/history session and source close.
- A history child ignoring stdin EOF and SIGTERM is killed with SIGKILL when the
  source closes; the pending history rejects, close is observed, and subsequent
  reads do not create another child.
- **A resolved source bootstrap is not evidence of normal bootstrap-child exit.**
  ReadonlyRpcClient.close accepts confirmed forced exit; LiveSource can then open
  the usable reader. This is existing application recovery behavior, not changed
  by this work. A measurement supervisor must reject such an arm explicitly,
  using exit code/signal and signal-attempt observations rather than only awaiting
  source.close or checking the client's logical closed flag.

The full suite passes 131 tests on available Node 24.19.0, and typecheck passes
on Node 22.23.1. Production code remains unchanged. No Mac, exact Node 24.20.0,
browser/build or independent review was run. This is lifecycle evidence, not a
completed supervisor: test-local capture is not wired into a runnable experiment.
Next implementation must register every bootstrap/reopened child at creation,
fail closed after forced/uncertain shutdown, close all registered handles on
every failure path, and admit the owned listener before sending credentials.
Artifact/source verification, cross-arm parity and C06 gates remain pending.
