# Lead integration review — 2026-09-11

This is the implementing lead's source/test review, **not independent approval**.
Reviewed transport, owned-reader gate, workload, worker/session handoff, parent
watchdog, private registry and external residue boundaries. No Mac execution or
upstream source attestation occurred. Existing untracked review material was not
changed or presented as a new independent review.

## Fixed: unexpected exit could be relabeled during the exit/close gap

The owned-reader gate previously observed ChildProcess `close` only. An unexpected
zero-code `exit` could occur while inherited/undrained stdio delayed `close`.
Calling wrapped client.close in that interval set closing:true; the later close
could then look requested and normal. This violated the requirement to reject
unexpected reader death before a replacement bootstrap.

The gate now observes `exit` independently and permanently marks an exit without
a preceding close request as failure. It also suppresses calls to the underlying
kill method once exit is observed, including calls made through client cleanup.
Its own fallback waits for pipe close without sending TERM/KILL to an exited
child. Missing close still detaches local pipes and reports allClosed:false.
This aligns the reader gate with the parent watchdog's existing exit distinction.

Two added event-controlled regression tests cover delayed close after unexpected
exit and retained pipes after exit (including a client attempting TERM). Existing
native normal/forced-bootstrap/session tests continue to pass. The change is in
experimental measurement tooling, not the production RPC client or UI.

## Remaining admission blockers (not solved by more passing unit tests)

1. The Linux app stage is only a self-consistency artifact. No reviewed pinned
   Mac app/runtime/imsg bundle, exact Node24.20.0 runtime, compiler/source
   provenance, launch environment or import closure has been admitted.
2. Both exact upstream RPC initialization/status paths still require the planned
   no-launch audit. Removing Web CLI status does not prove upstream has no
   launch/repair side effects or writes. Do not use doctor/old diagnostics.
3. Registry completeness depends on trusted worker code and a gate that permits
   only bootstrap+reader. External absence checks are instantaneous observations
   of those recorded resources, not discovery/proof of every possible descendant.
   Missing registration or uncertain cleanup must retain ownership and forbid
   retry/promotion, even if a worker claims cleanup success.
4. The v2 parent completion protocol now carries a validated fixed-field numeric
   sample, discarded on any failure or incomplete registry/residue observation.
   Legacy boolean-only records remain lifecycle-only with sample:null. This is
   still **not an admitted performance recorder**; do not call success C06.
5. Same raw chat target and ordered payload/name parity across baseline/candidate
   are not connected to this pipeline. Random per-session Web IDs cannot establish
   equivalence. Counterbalancing and the full20-sample/30-minute gate remain.
6. Claude's independent review has now been received and triaged in
   `nonlaunch-independent-review-2026-09-11.md`. Two adopted fixes still require
   re-review; neither review authorizes a Mac run, fork adoption, stock-binary
   replacement, Agent installation, Serve publication or production restart.

## Verification

After the fix, `npm run test:nonlaunch` builds fresh dist and passes all53 tests;
the separate application suite passes all149 tests, both using Node24.19.0.
git diff --check passes. Typecheck/browser/exact24.20.0 were not rerun in this
tooling-only change. No live data, remote access or production mutation occurred.

## Numeric sample follow-up

V2 schema and parent success/failure projection tests bring the preparation suite
to56 passing tests on Node24.19.0, with fresh build. Registry assertions were then
strengthened to require null samples on incomplete registration and non-success;
all12 registry tests pass again. The separate149 application tests and diff check
pass. No browser run or exact24.20.0 validation occurred. A selected source packet
was submitted to Claude Opus (medium, no tools, safe-mode, no session persistence)
for the outstanding independent review; submission alone is not approval.
