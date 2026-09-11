# Parent-side worker watchdog — 2026-09-11

`scripts/supervise-api-worker.mjs` implements a watchdog running outside the
application worker's event loop. Its trusted factory must synchronously create
and return one fresh ChildProcess with piped stdio, with no unregistered child
created before throwing. It is not a CLI launcher or artifact-admission layer.

The worker emits exactly one UTF-8 JSON line. The v2 contract is:

```json
{"event":"complete","version":2,"sessionSucceeded":true,"cleanupConfirmed":true,"sample":{"capabilitiesMs":1,"chatsMs":2,"historyMs":3,"cycleMs":7,"chats":1,"messages":1,"nonemptyHistory":true}}
```

Legacy three-field boolean records remain accepted for lifecycle-only tests,
with sample:null. V2 failed reports require sample:null. Successful v2 records
require the exact seven-field numeric sample: finite timings from 0 to 60000 ms
at tenth-ms precision, bounded counts (chats 1–50, messages 0–50), consistent
nonemptyHistory and stage/cycle timings (0.2 ms aggregate rounding allowance).
Only normal completion retains the projected sample; any later failure or
incomplete registry/residue observation discards it. No raw objects are exported.

2026-09-12 boundary correction: `superviseApiWorker` is strictly lifecycle-only
and ALWAYS returns sample:null, even on normal v2 completion. Candidate-producing
logic is private inside `nonlaunch-registry.mjs`; only `superviseRegisteredWorker`
can export it after complete registration and observed absence. The original
supervisor module is a compatibility re-export, not a bypass. A final external
AbortSignal check discards values when cancellation arrives after worker close.

Total stdout is capped at 1024 bytes; stderr, malformed/extra output, failed spawn,
nonzero/signal exit, deadline or external AbortSignal fails the run. The completion
record is provisional until the worker and its stdio close normally. stdout and
stderr are never forwarded. No credentials, IDs, paths or arbitrary worker error
strings enter the returned record; only the validated numeric sample is exported.

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

## Joined worker bridge — 2026-09-11 follow-up

Added `scripts/nonlaunch-api-worker.mjs`, a trusted entry-point adapter. It installs
stdin EOF/error/unexpected-data cancellation plus SIGINT/SIGTERM/SIGHUP handlers
before calling the supplied startup function. Startup must track partial
resources and observe AbortSignal; cleanupStartup is used if startup throws.
Once ready, the existing session runner owns cleanup. The bridge removes signal
handlers, closes stdin, and flushes one fixed completion record only after the
session or startup cleanup returns. Exceptions never become printed diagnostics.
This does not select a binary, load arbitrary paths or approve a bundle.

`tests/fixtures/nonlaunch-api-worker.mjs` is a synthetic-only executable bridge:
it loads freshly built application modules, creates its own ephemeral loopback
server/Auth, runs LiveSource with real Node fake-RPC children registered through
onChild, and uses only a temporary synthetic database file. It never invokes
imsg or accesses Messages. Build first, then run:

```sh
npm run build
node scripts/nonlaunch-worker-bridge.test.mjs
```

Four parent/worker/native-reader integration cases pass: normal API completion,
parent deadline/EOF interrupting pending history without a forced kill, partial
startup failure, and SIGTERM-driven worker cancellation with cleanup reporting.
This confirms the protocol wiring with real HTTP and nested processes. It does
not independently prove descendant/listener absence after a worker crash:
descendantStopConfirmed remains false in all parent reports.

Integration exposed a parent bug: after setting a timeout/abort failure reason,
it discarded the worker's subsequent cleanup acknowledgement. The parent now
continues bounded parsing after cancellation without allowing the failure reason
to become success. Malformed/trailing output invalidates the cleanup report.
The six parent watchdog regression tests also pass. Full application suite149
passes on Node24.19.0; build passes on Node22.23.1. No typecheck/browser rerun,
exact24.20.0, independent review, Mac execution or live admission this turn.

Next required work remains externally verifiable RPC-child/listener observation
for killed/crashed workers, then pinned Mac/runtime/imsg admission. Startup
callbacks/cleanupStartup can still hang in this event loop; the external parent
bounds worker lifetime but cannot infer the fate of unacknowledged descendants.
Never deploy this synthetic entry point or promote its reports to C06 evidence.
