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

## Owned-reader gate implementation — 2026-09-10 follow-up

Added `scripts/nonlaunch-owned-readers.mjs`. Its synchronous factory requires a
trusted constructor adapter to register each newly created ChildProcess before
returning the RPC client. Registration observes close/errors/stderr and wraps
that exact handle's kill method to record even failed signal attempts. There is
no global spawn monkey-patch, PID discovery, or runnable live entry point.

The gate allows at most bootstrap plus one usable reader. Wrapped client close
requires observed, requested, zero-code/no-signal exit with no signal attempts
or child errors. Forced or unexpected exit, stderr, missing/extra registration,
and constructor failure prevent replacement construction. In particular, the
native LiveSource integration now verifies that a stubborn bootstrap child is
closed and rejected **before the second child is spawned**. Normal bootstrap
and final shutdown still pass. Production source code has not changed.

Gate close initiates client cleanup for all registered children, then uses
bounded EOF/TERM/KILL waits against those exact handles, including a child left
behind by a throwing constructor. Missing close acknowledgement destroys local
pipes/unrefs the handle and returns allClosed:false, never success. An unresolved
client-close promise also prevents allNormal:true even if the OS child closed.
Output is only fixed booleans/counts with gateMeasurement:false. allNormal is
lifecycle evidence, not workload success, listener ownership or C06 acceptance.

Five standalone fault tests pass (constructor throw, missing close, signal with
exit zero, registration/stderr violations, unexpected exit zero). Full suite,
including two added native gate integrations: 133 passed on Node 24.19.0.
Typecheck passes on Node 22.23.1. A subsequent sandboxed full run failed across
existing subprocess/socket suites; approved unrestricted rerun passed all 133.
No Mac, independent review, exact Node 24.20.0, browser or build run this turn.

Remaining: the registration adapter is currently test-local. A reviewed isolated
application constructor must ensure every actual spawn is registered; this gate
cannot detect a trusted callback secretly creating an unregistered child. Wire
that adapter to verified artifact admission and listener ownership, then join
transport close, session revocation, source/gate close, and signal/whole-run
deadlines in one supervisor. Do not use this module alone as live authorization.

## Joined isolated session — 2026-09-11

Added `scripts/nonlaunch-api-session.mjs`, joining one API workload cycle with
authentication, bounded GET transport and mandatory cleanup. The caller transfers
an already-listening, exclusively owned app and its matching Auth, source and
reader gate. This must never receive production/shared resources: all sessions
are revoked and the app is closed, even on setup/read failure. It verifies an
active literal-loopback listener, issues a session via the local Auth instance
(outside the timed workload), and never returns credentials or raw errors.

Finally revokes credentials first, starts transport/source/gate closure together,
then awaits app closure. Independent gate cleanup still runs when source.close
rejects. A successful sample is retained only if every cleanup acknowledgement
passes, including normal reader exit; all results remain gateMeasurement:false.
An AbortSignal reaches GET transport, and ensuing source closure interrupts
pending upstream work rather than assuming socket closure did so.

Eight new integration cases cover normal completion, read/source-close failure,
forced reader exit, pre-abort, abort during pending history, and two actual
LiveSource/ReadonlyRpcClient subprocess sessions over loopback HTTP. The native
normal case closes both children and listener with zero remaining sessions; the
stubborn-bootstrap case closes its sole child and never spawns a replacement.
Full suite: 141 passed on Node 24.19.0; typecheck passed on Node 22.23.1;
git diff --check passed. Production source/UI unchanged. No Mac, browser/build,
exact Node 24.20.0 or independent review was run in this follow-up.

This is a one-cycle owned-resource runner, not the complete live supervisor.
It does not start/admit an application artifact, establish matching resource
identity, persist owner state, or register real production child spawns. The
trusted caller is responsible for those relationships. Local Auth login is not
a test of remote login or Secure-cookie browser handling. It waits for cleanup
promises rather than abandoning them: a defective/hung source or app close can
still prevent return. Whole-run/startup/cleanup watchdogs and process-signal
wiring therefore remain required in the outer supervisor, alongside artifact
audit, listener admission, raw-target parity and full C06 scheduling. Do not
interpret this short integrated run as live-use approval or a performance pass.

## Session/cleanup watchdogs — 2026-09-11 follow-up

The joined runner now has a 45-second default whole-cycle budget (distinct from
each GET's 15-second limit) and a shared 10-second cleanup observation budget.
Both are bounded configurable positive integer durations, at most 60 seconds.
The cycle deadline aborts transport; external cancellation is bridged through the
same controller. Monotonic checks also reject late completion when a timer's
callback has not yet run. Cleanup begins by revoking sessions, then initiates
transport, source, reader-gate **and app** close without serially waiting on a
potentially hung close. This supersedes the prior sequential app-close ordering.

Cleanup timeout returns failure with cleanupExpired:true and leaves every
unacknowledged field false. Output copies cleanup flags so later completions
cannot upgrade an already-returned result. Successful samples are discarded on
interruption, either deadline, or any cleanup failure. All started cleanup
promises retain rejection handlers; timeout does not imply the underlying work
stopped, authorize retry, or authorize releasing a live owner marker.

Five added tests cover cycle expiry during pending history, independently hung
source/gate/app cleanup with late-completion immutability, and invalid watchdog
configuration. Full suite: 146 passed on Node 24.19.0; typecheck passed on Node
22.23.1. No production sources/UI or Mac artifacts changed.

Remaining boundary: these timers need a responsive Node event loop. They cannot
preempt synchronous blocking code, stop an unregistered process, or ensure a
failed app.close actually releases the listener. The outer watchdog must retain
ownership on uncertainty and verify exact-process/listener exit. The runner
still receives an already-listening app; main.ts's production startup directly
constructs LiveSource and startRuntime, so it is not silently repurposed as the
isolated launcher. Artifact/digest/source admission, real child registration,
startup supervision and OS-signal wiring remain unimplemented for live use.
No independent review, exact Node 24.20.0, browser/build or Mac run this turn.

## Real constructor registration — 2026-09-11 follow-up

Added an optional, trusted server-only `onChild` observer to ReadonlyRpcClient.
It receives the actual ChildProcess synchronously after IO/error handlers are
installed, before construction returns. Invalid observer types are rejected
before spawn. If the observer throws, construction throws a redacted
CONFIG_INVALID and starts the client's existing exact-child shutdown policy.
The observer can register even an asynchronously failed-spawn handle so close
acknowledgement remains observable. This is a small production-code change;
ordinary callers omit the option and retain existing behavior. No HTTP input,
DTO, executable whitelist, RPC method list or UI code changed.

Native measurement-gate fixtures now connect through this real observer:

```js
factory: () => gate.factory(register => new ReadonlyRpcClient({
  executable: admittedExecutable,
  onChild: register,
}))
```

`admittedExecutable` in this fragment must come from reviewed artifact admission,
not request input. Tests still observe spawn ordering independently, but the gate
no longer obtains registration through a mocked/global spawn replacement. The
existing joined HTTP/native subprocess sessions and forced-bootstrap rejection
therefore exercise the actual registration path intended for the isolated app.

Three added native tests verify synchronous single registration, cleanup after
observer exception, and failed-spawn close observation. Full suite: 149 passed
on Node 24.19.0; typecheck and build passed on Node 22.23.1. git diff --check
passed. Exact Node 24.20.0, browser suite, independent review and Mac execution
remain unperformed in this follow-up.

This closes the test-only registration seam, not the complete startup gate.
Next remains an isolated launcher with pinned app/runtime/imsg artifact and
source verification plus an independent outer watchdog. Existing verifyArtifact
only checks one private-root executable's digest; it does not admit the app's
whole import/dependency tree or attest source provenance. Production startRuntime
uses owner lock/admin state and is not silently reused or weakened. No permanent
Agent, Serve route, installed binary replacement or live measurement occurred.
