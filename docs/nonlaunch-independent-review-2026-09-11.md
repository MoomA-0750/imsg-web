# Claude independent review — 2026-09-11

Claude Opus was invoked with medium effort, safe-mode, no tools, dontAsk/no
permission prompts and no session persistence. Fable was prohibited. A selected
source-only stdin packet was sent; no credentials, real messages, private Vault
content, file access or command execution was provided. CLI completed with exit0.
This was static review, not execution or live admission. The submitted snapshot
included the unfinished v2 numeric transport, before its new boundary tests.
`nonlaunch-independent-review-request.md` records the request and constraints.

Supplied sources: workload, transport, owned-reader gate, session, worker, parent
watchdog, registry, residue, bundle validator, sample validator, ReadonlyRpcClient,
and the owned-reader/registry/worker-bridge tests. LiveSource, HTTP/Auth and fixture
implementations were not included; claims depending on them required lead checks.

## Findings and lead disposition

The following is a paraphrased disposition, not a verbatim transcript. Severity
labels A/B/C reflect Claude's original grouping, not automatic lead acceptance.

- **A-1 — adopted:** child `close` can precede client-close promise settlement.
  The old gate could reject normal delayed bookkeeping immediately. Retain the
  client promise and allow one additional bounded grace after OS close. A new
  test covers delayed success, never-settling acknowledgement and no late upgrade.
  Native bridge tests already existed, contrary to the review's suggestion that
  only mock clients were covered; they did not cover deliberately delayed settle.
- **A-2 — adopted as defensive hardening:** a trusted startup adapter could resolve
  with incomplete transferred resources. Invoke idempotent cleanupStartup after
  incomplete session cleanup too, without upgrading cleanupConfirmed/sample.
  Test an empty resolved resource object and successful fallback cleanup: final
  failure and null sample must remain. This does not make arbitrary hidden
  resources discoverable; the trusted adapter must retain exact ownership.
- **A-3 — deferred contract alignment:** workload accepts 1–128 token characters,
  transport requires43 for chat IDs. Lead inspected LiveSource: HMAC-SHA256
  base64url IDs are always43, while epochs are32 hex characters. Thus this is not
  an actual current always-failing production path. Later separate chat-ID from
  epoch validation and align fixtures/contracts; never widen transport blindly.
- **A-4 — addressed since submitted snapshot:** v2 fixed-schema tests now cover
  extra fields, invalid numbers/counts/flags/timings, invalid version/null sample,
  failed cleanup with a sample, legacy null, and discard after nonzero/stderr/
  deadline or incomplete registration. Not live-measurement acceptance evidence.
- **B-1 — retained deliberately:** legacy outcome:ok is lifecycle success with
  sample:null and gateMeasurement:false. Any future recorder must require a
  validated non-null sample plus all independent admission gates. A new version
  field in the public result is optional future work, not current false approval.
- **B-2 — deferred naming clarification:** workerClosed:true on pre-spawn failure
  means no owned direct worker remains; outcome remains spawn, no sample, and
  safeToRelease is never true. A childCreated flag may clarify later aggregation.
- **B-3 / D sample consolidation — deferred:** internal workload/session records
  deliberately differ from the external seven-field wire DTO. Explicit worker
  projection and parent revalidation preserve the boundary; no current leak.
- **B-4 — deferred diagnostics:** stderr must still fail closed. A fixed
  stderrObserved flag could improve diagnosis, but do not publish raw stderr.
- **B-5 — rejected:** the HTTPS canonical Host/Origin intentionally differs from
  the ephemeral literal127.0.0.1 HTTP connection. Restricting origin to that port
  breaks the actual application's canonical-origin authentication contract.
- **B-6 — deferred:** centralize expected two-reader count when changing this
  policy; current gate and decoder agree and require bootstrap+usable reader.
- **B-7 — deferred:** an observationAttempted flag could distinguish skipped from
  failed observation. registryComplete:false already explains skipped probing;
  uncertainty stays conservative and cannot release ownership.
- **C-1 — deferred:** signal during final output flush may truncate the ACK; parent
  rejects signal/partial output and discards sample. Keeping a no-op handler would
  complicate parent shutdown semantics and requires dedicated tests first.
- **C-2 — deferred trusted-factory robustness:** malformed ChildProcess-like
  objects that throw during listener wiring could skip grace. Native owned
  ChildProcess/EventEmitter contracts do not exhibit this; no launcher should
  accept untrusted child-shaped objects. Test before changing this error path.
- **C-3 — rejected for this scope:** connection-wide RPC_TIMEOUT describes a
  connection teardown caused by timeout. Changing production error semantics for
  unrelated pending requests is not necessary for sequential measurement prep.
- **C-4 — no broad cleanup:** retain both cleanup timeout and post-deadline check;
  the latter catches delayed timer dispatch. Timer count is bounded. Exact file
  names need not be Unicode-normalized; changing normalization alters manifest
  identity. Overlap refusal is not a retry policy. Worker wire records are private
  protocol; parent reports always add gateMeasurement:false.
- **D watchdog/registry merger — deferred:** separate lifecycle and private-fd
  decoder boundaries are independently testable. No demonstrated safety gain
  justifies merging now. Retain ownership checks, seal/EOF, PID before/after
  observation, and worker/parent validation at both trust boundaries.

## Still not admitted

Claude explicitly did not approve live execution. Both reviewer and lead retain
the missing raw cross-arm target/payload/name parity, counterbalanced20 samples /
30-minute C06 gate, independently pinned Mac/runtime/imsg artifacts and source,
Node environment/import closure, mutable-path race handling and upstream
no-launch audit. Node24.20.0 and the actual Mac deployment have not been verified.
No Mac access, production restart, binary replacement or external push occurred.

The adopted A-1/A-2 corrections require a fresh independent re-review before
calling the revised implementation independently approved. This review is now
received and triaged, not an endorsement of the corrected snapshot.

## Verification and continuation

After A-1/A-2 fixes, fresh build and all58 preparation tests pass on Node24.19.0;
diff check passes. The149 application tests passed before those script-only fixes
and were not rerun afterward. Browser and exact24.20.0 checks were not performed.
Next: independently re-review the two fixes and new schema tests, then resolve
remaining admission blockers. Do not launch Mac measurements from these results.
