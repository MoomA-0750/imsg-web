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
