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
