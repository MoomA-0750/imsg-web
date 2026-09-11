# Focused independent re-review — 2026-09-12

Review the supplied current sources and tests independently. No file operations,
commands, outside research, Fable, live execution or production approval.
Return concise Japanese findings: severity, exact file/function, concrete failure
scenario, and minimal correction. Separate verified defects from optional cleanup
and unmet live-admission prerequisites. Do not invent missing code behavior.

Scope:
1. Owned reader OS close and client-close promise settlement are independent.
   A bounded final grace now waits for the retained client promise after OS close.
   Unresolved/rejected close, forced signal or unexpected exit must not be normal;
   late settlement must not upgrade returned reports.
2. Worker now calls idempotent cleanupStartup after incomplete session cleanup,
   as well as startup rejection. Fallback success must not upgrade failed session
   cleanup/sample. Trusted startup must register exact partial resources; arbitrary
   hidden descendants are not discoverable. Parent watchdog bounds worker lifetime.
3. V2 fixed seven-field numeric sample is validated in worker and parent. Keep it
   only after successful workload, normal completion, full private registration
   and observed registered-resource absence. Legacy success is lifecycle-only with
   sample:null. Extra data, invalid numbers/counts/timing relationships, failed
   cleanup and subsequent deadline/exit/protocol failure must discard the sample.
4. Review new boundary/regression tests and native synthetic bridge fixtures.

Constraints: gateMeasurement:false and safeToRelease:false remain mandatory.
No raw messages, IDs, names, credentials or arbitrary errors in public output.
Canonical HTTPS Host/Origin intentionally differs from literal loopback HTTP
transport address; do not weaken or replace production authentication.
Live Mac/runtime/imsg provenance, upstream no-launch audit, cross-arm raw parity,
20-sample/30-minute C06 remain separate unmet gates, not acceptance by this review.

Please state whether each of1/2/3 has any remaining blocker within this scope,
with evidence. Passing local tests is not itself proof; if assumptions prevent a
conclusion, identify the exact assumption. Avoid re-reviewing unrelated UI design.
