# Parent-side worker watchdog — 2026-09-11

`scripts/supervise-api-worker.mjs` implements a watchdog running outside the
application worker's event loop. Its trusted factory must synchronously create
and return one fresh ChildProcess with piped stdio, with no unregistered child
created before throwing. It is not a CLI launcher or artifact-admission layer.

The worker may emit exactly one UTF-8 JSON line, with exactly these fields:

```json
{"event":"complete","sessionSucceeded":true,"cleanupConfirmed":true}
```

Total stdout is capped at 256 bytes; stderr, malformed/extra output, failed spawn,
nonzero/signal exit, deadline or external AbortSignal fails the run. The completion
record is provisional until the worker and its stdio close normally. stdout and
stderr are never forwarded. No timings, credentials, IDs, paths or arbitrary
worker error strings enter the returned record.

On completion or failure the parent ends worker stdin, allowing a future worker
entry point to interpret EOF as a cleanup request. If close does not arrive,
bounded grace periods send TERM and then KILL through that exact ChildProcess
handle. After observing exit, no more signals are sent; inherited open pipes
produce cleanup-unconfirmed instead of attempts to kill descendants or reuse a
numeric PID. Missing close destroys local pipes/unrefs the worker and explicitly
returns workerClosed:false. No process-group or discovered-PID signalling exists.

## Crucial boundary

`workerClosed` is only direct-worker/stdio acknowledgement. `workerCleanupReported`
is only the worker's provisional claim. **descendantStopConfirmed is always
false**, even on outcome:ok, and gateMeasurement is always false. This deliberately
prevents the new watchdog from pretending to establish RPC-child/listener exit.
It is not sufficient for live admission or for releasing a production owner lock.

The previous session runner and this parent are not yet joined by an admitted
worker entry point. That entry point must bind stdin EOF/signals to cancellation,
send its fixed record only after session cleanup, and have a reviewed strategy
for separately observing every RPC child and listener if the worker crashes or
is killed. Simply wrapping main.ts or treating worker exit as process-tree cleanup
would not meet that requirement. The parent also assumes its own event loop and
trusted synchronous spawn factory remain responsive.

## Verification

Six tests pass on Node24.19.0 with approved unrestricted execution. Real synthetic
Node workers cover normal result+exit, nonzero/no report, extra/oversized/private
diagnostics, false success, an infinite synchronous loop with ignored TERM,
external abort/pre-abort and construction failure. A synthetic event emitter
covers worker exit without pipe close and confirms no descendant signal attempt.
The sandboxed positive worker case did not produce the expected normal record;
the same suite passed unrestricted. No raw worker output was printed.

No Mac or staged app execution, independent review, exact24.20.0, production
source change, full app suite or browser/build run occurred in this additive
watchdog turn. Run `node scripts/supervise-api-worker.test.mjs`. Diff check passes.
