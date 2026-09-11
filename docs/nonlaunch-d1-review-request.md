# Focused follow-up: D1 sample boundary

Independent static review only; no tools, commands, external research or Fable.
Previous review accepted OS/client-close settlement and fallback cleanup with
trusted-startup/idempotence assumptions, but found conditional blocker D1:
exported lifecycle supervisor exposed samples before private registry admission.

The candidate-producing supervisor is now an unexported function in the registry
module. Both public lifecycle imports call a wrapper that always returns
sample:null. Only superviseRegisteredWorker returns a sample, after complete
registry and observed registered-resource absence. The old supervisor module is
a compatibility re-export, with no cycle. Its core logic is otherwise unchanged.
Also check final external AbortSignal state so cancellation after worker close,
during final observation, discards the sample. A native regression covers that gap.

Check whether D1 is resolved without new regressions; report remaining concrete
blockers with file/function and scenario, distinguishing optional improvements.
The exposed decoder cannot manufacture a private candidate. Trusted factories
remain trusted, not adversarial code. This is not authorization for live use:
gateMeasurement:false, safeToRelease:false remain mandatory; artifact/runtime/
upstream no-launch/parity/C06 admission remain outside this review.
