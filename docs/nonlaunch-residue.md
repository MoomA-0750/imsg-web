# External registered-resource observations — 2026-09-11

`scripts/nonlaunch-residue.mjs` provides read-only `observeResidue` for a trusted
registry containing one to three exact positive PIDs, one loopback port and an
explicit registryComplete boolean. It never discovers or terminates a process,
releases an owner lock, or contacts a nonloopback address. PID signal0 is an
existence check, not a termination signal. A TCP connection sends no data and
is destroyed, with its close awaited before returning.

PID absence requires ESRCH both before and after the asynchronous TCP probe.
Listener absence requires ECONNREFUSED; permissions, timeout and other ambiguous
errors remain uncertain. Reused PIDs or listening ports are conservatively
present, regardless of who now owns them. Duplicate/special PIDs and malformed
port/timeout/registry input are rejected before any observation. Output contains
only fixed booleans, never PIDs or port values.

registeredResourcesAbsent becomes true only when the registry is declared
complete and every recorded process/port is observed absent. Even then,
safeToRelease and gateMeasurement remain false. These are time-local observations,
not guarantees against reuse after return or proof no unregistered descendant
exists. A zombie may conservatively count as present until reaped.

## Native verification

Three tests pass on Node24.19.0 with approved unrestricted execution:

- A normal synthetic worker and its child terminate/reap; both PIDs and the
  child's listener are then observed absent. Incomplete registry still fails.
- Killing only the directly owned synthetic worker leaves its child and listener
  alive. The observer reports residual processes/listener and no release safety.
  The descendant is never signalled by numeric PID; it self-exits after1.8s.
- Dangerous/duplicate/special PID and invalid port inputs fail validation.

Fixtures create no files or Message data and invoke no imsg. Tests await natural
child expiry before returning, and neither scan nor kill unrelated processes.
The listener deliberately lives in the child to prove worker exit alone is
insufficient. No actual measurement-worker registry is implied by these fixtures.
Run `node scripts/nonlaunch-residue.test.mjs`. git diff --check passes. No full
application suite/typecheck/build/browser, exact24.20.0, Mac or independent review
run in this additive observation turn.

## Remaining integration requirement

The actual measurement worker must transfer a bounded, authenticated-by-ownership
registry over a separate channel without mixing it with public result output.
The parent must know registration is complete before it can interpret absence;
a crash between spawn and registration must remain incomplete/unsafe, not an
empty process list that vacuously passes. No missing PID/port may be fabricated.
The current parent watchdog still returns descendantStopConfirmed:false. This
observer is not yet wired to it or an admitted Mac worker. Source/artifact audit,
registry completeness, worker/listener identity and review remain live-use gates.

## Private registry bridge — 2026-09-11 follow-up

`scripts/nonlaunch-registry.mjs` now connects the parent watchdog to residue
observation through a separate inherited fd3 pipe. stdout remains only the fixed
public completion protocol. The parser accepts at most1024 bytes, in order:
one listener port, exactly two distinct RPC child PIDs (different from the owned
worker PID), then a sealed marker. Exact fields/types are required; overflow,
extra/truncated frames, malformed UTF-8, early seal and duplicate PIDs reject.
Both seal and EOF are required before registryComplete can become true.

The synthetic measurement worker emits listener registration after its own bind,
then each child registration synchronously via the real onChild observer. Seal
follows the second registration and relies on the trusted gate forbidding further
spawn/recovery. The parent supplies the worker PID from its own ChildProcess,
not from a worker-supplied identity. Invalid registry cancels the worker through
the existing watchdog and cannot throw away ownership of an already-created
worker. The private pipe is also destroyed when watchdog observation finishes.

After worker supervision, only a complete, valid registry is passed to the
external PID/port observer. A provisional successful stdout result is downgraded
if the registry is incomplete or registered resources cannot be observed absent.
Timeout/crash/failure never upgrades to success even if subsequent absence checks
pass. Returned records contain fixed booleans/categories, not the private IDs.
safeToRelease and descendantStopConfirmed still remain false: a private pipe
binds data to this worker, but is not proof an unreviewed worker truthfully lists
every possible descendant, nor proof against source/binary behavior outside the
gate. Mac/source/runtime admission remains required.

Six registry tests pass on Node24.19.0 with approved unrestricted execution:
fragmented complete and partial records, malformed/duplicate/overflow records,
real normal/EOF-interrupted/startup-failed measurement workers with external
absence checks, and a successful stdout report with an empty private registry.
The four preexisting worker-bridge tests also pass. No production source changes,
full app suite/typecheck/build/browser rerun, exact24.20.0, independent review or
Mac access this turn. The fixture uses the existing built dist; build before
running `node scripts/nonlaunch-registry.test.mjs` in a fresh checkout.

Next: failure injection for mid-registration worker crashes and retained private
pipes, then review the complete local chain and establish admitted Mac artifacts.
This synthetic connection is not a production worker entry point or C06 run.

## Registration crash/pipe fault coverage — 2026-09-11 follow-up

Added six further registry cases (12 registry tests total): real synthetic workers
self-terminate via SIGKILL after zero, one, two or three registration frames;
an exited worker with a retained private pipe never supplies EOF/close; and a
worker lacks fd3 entirely. Every case remains incomplete and cannot confirm
registered-resource absence. The four crash workers emit synthetic numeric
records, not actual RPC children; incomplete registries never reach PID probing.
Normal/EOF-interrupted real RPC integration remains covered separately.

The retained-pipe test uses an event-emitter fault seam: it verifies the hard
watchdog result is cleanup-unconfirmed, all four local pipe handles are destroyed,
and neither the already-exited worker nor any descendant is signalled. A later
close event cannot upgrade the returned report. Missing fd3 cancels and closes
the already-owned real worker rather than losing its handle. No additional
implementation defect was found in these cases.

Added `npm run test:nonlaunch`: builds fresh dist first, then runs every standalone
nonlaunch suite and the parent watchdog suite serially. This removes reliance on
stale dist when invoking the combined regression command. All51 tests pass on
Node24.19.0 with approved unrestricted execution, including transport, workload,
bundle, owned-reader, registry, residue, worker bridge and parent watchdog cases.
Build also passes on24.19.0; typecheck passes on22.23.1 and diff check passes.
The separate149-test application suite/browser checks were not rerun this turn.
No Mac, exact24.20.0 or independent review was run; no live artifact is admitted.

The local preparation chain now has a reproducible combined regression command.
Next is review of the combined trust/ownership boundaries and reconciliation with
pinned Mac app/runtime/imsg sources and artifacts, before any live execution.
Passing synthetic tests is not independent review, C06 acceptance or authorization
to release uncertain ownership markers.
