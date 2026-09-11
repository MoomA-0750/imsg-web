# Independent re-review — 2026-09-12

## Scope and user feedback

User exercised the synthetic preview from separate PC/phone and found no apparent
malfunction. This is functional/display feedback only, not final acceptance of
normal-use specifications or appearance. Real source-data correctness remains
unverified. Requested next step was independent re-review, not Mac execution.

Claude Opus, medium effort, safe-mode, no tools, dontAsk/no permission prompts,
no session persistence, Fable prohibited. Selected sources/tests only via stdin;
no real messages, owner credentials, private Vault contents or filesystem access.
Both requests are preserved alongside this record. Findings below are paraphrased.

## First response (CLI exit0)

- OS/client-close settlement: no scoped blocker. Late unresolved/rejected close
  cannot upgrade returned snapshots. Optional test: delayed rejection specifically.
- Fallback cleanup: no scoped blocker under trusted, idempotent startup/cleanup
  contracts. Fallback success does not upgrade failed sessions or their samples.
- **D1, conditional blocker accepted:** the exported lifecycle supervisor could
  expose a candidate sample without private registry/resource absence observation.
  Relying on callers to choose the correct entry point was not enforced by code.

D1 correction: move candidate-producing logic into an unexported function in the
registry module, with two public entry points. Lifecycle supervisor always returns
sample:null; registered supervisor alone retains values after complete registry
and absence checks. Old import path is a compatibility re-export, not another
implementation. No import cycle. Updated native and protocol tests accordingly.

Lead also found that external cancellation after direct worker close could be
missed while residue observation awaited. Final signal state now invalidates the
sample. Native test queues cancellation from worker close and requires interrupted
with null sample. Both corrections were sent for focused independent follow-up.

## Optional findings and assumptions

- Startup cleanup reports confirmed closure, not necessarily normal measurement
  shutdown. Keep this distinction: failed startup never yields a sample, and
  forced cleanup must not be relabeled a successful run.
- Gate permitting a single child is acceptable as an ownership primitive; full
  measurement registry independently requires exactly bootstrap+usable reader.
- Floating-point tolerance edge and more schema/residue combination tests are
  optional hardening, not acceptance blockers identified in this review.
- Listener-first private registration intentionally fails partial startup closed;
  trusted startup must retain resources for cleanup even before registry completes.
- LiveSource ordering/idempotence and startup responsiveness are trusted-adapter
  assumptions. Future admitted launcher must establish them against exact code.
  This synthetic adapter is not an approved production startup implementation.
- Fresh dist was built before all preparation tests, addressing stale-artifact
  concerns for these local tests only, not exact Mac/runtime provenance.

## Verification

Before D1 correction: fresh build,58 preparation tests,149 application tests pass.
After D1/cancellation correction: fresh build and59 preparation tests pass, using
Node24.19.0. Application source was unchanged by these tooling-only corrections;
149 suite was not rerun afterward. No browser/exact24.20.0/Mac validation.

No production restart, Mac access, upstream execution, publication or push.
Existing untracked nonlaunch-status-review.md preserved untouched.

## Focused follow-up response (CLI exit0)

Claude concluded D1 is resolved and found no new concrete blocker within the
trusted-startup/factory and idempotence assumptions. It confirmed the private
candidate function is not exported, lifecycle results always strip samples,
registry results require complete/absent/non-aborted status, and compatibility
imports introduce no cycle. The final abort check after observation closes the
late-cancellation gap in the reviewed code.

Optional improvements retained, not silently claimed tested: the native queued
abort test targets after-close but before observation continuation, not a precisely
injected mid-observation abort; residue probing may continue up to its bounded
timeout after abort; fixed registry-rejection diagnostics and export-set tests
could improve future regression coverage. No extra injection framework was added.

**Step1 complete for this scope.** The result is a scoped independent review,
not proof of authentic worker measurements from arbitrary factories. Raw child
stdout is still accessible to its trusted owner. The next step is exact app/Node/
imsg artifact and launch-condition verification plus upstream no-launch audit,
before any authorized real-data parity/performance work. No production approval
or C06 acceptance follows from this review. Diff check passed before commit.
