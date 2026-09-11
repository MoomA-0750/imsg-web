# Development checkpoint — 2026-09-09

## Latest update — 2026-09-11 joined parent/worker/native RPC path

Connected the session runner to a worker entry adapter with EOF/OS-signal cancellation and partial-startup cleanup. Four synthetic integrations now traverse parent watchdog → worker → real HTTP/Auth/LiveSource → Node fake-RPC children, covering normal completion, deadline/EOF, startup failure and SIGTERM. Fixed parent handling to retain bounded cleanup ACKs after failure without upgrading timeout to success. Six watchdog regressions and all149 app tests pass on Node24.19.0; build passes on22.23.1. Descendant/listener absence after worker crash remains unproven; no live launcher/admission or Mac changes. [Evidence and remaining boundary](docs/nonlaunch-worker-watchdog.md).

## Latest update — 2026-09-11 parent-side worker watchdog

Added a separate-event-loop worker watchdog with bounded EOF/TERM/KILL cleanup, strict fixed completion protocol and no forwarded diagnostics. Six synthetic tests pass on Node24.19.0, including a synchronously blocked real worker and missing stdio close. Direct-worker closure is explicitly not RPC-child/listener proof: descendantStopConfirmed remains false and no live launcher is provided. The admitted worker bridge and independent descendant/listener observation remain required. No production/Mac changes. [Contract and limits](docs/nonlaunch-worker-watchdog.md).

## Latest update — 2026-09-11 actual app staging check

Created a private local stage from fresh dist plus55 runtime dependency packages using offline npm ci with install scripts and bin links disabled. All2,189 files/15,928,498 bytes passed inventory self-consistency verification; staged synthetic login/chats/HTML smoke passed and sessions returned to zero. Eight bundle tests and build pass. The generated inventory is explicitly unapproved; the stage excludes Node/imsg binaries and is not a Mac deployment artifact. No production/remote changes. [Preserved evidence, runtime caveats and next gates](docs/nonlaunch-bundle.md).

## Latest update — 2026-09-11 static bundle inventory verification

Added a read-only complete-tree verifier with externally pinned manifest digest, exact file hashes/modes/ownership, no symlinks/hardlinks or unlisted entries, and bounded streamed reads. Six synthetic filesystem tests pass on Node 24.19.0 in approved unrestricted execution; diff check passes. No production or Mac changes. This does not attest source/import safety or atomically verify-and-execute; actual packaging/admission and the outer process watchdog remain pending. [Manifest contract, tests and limitations](docs/nonlaunch-bundle.md).

## Latest update — 2026-09-11 real child registration

ReadonlyRpcClient now offers a synchronous server-only onChild observer, with redacted construction failure and exact-child cleanup if it throws. Native measurement-gate/session tests use this real registration path instead of the test-local spawn registration seam. Ordinary callers, HTTP/UI contracts, executable admission and RPC whitelist remain unchanged. All 149 tests pass on Node 24.19.0; typecheck/build pass on Node 22.23.1. No Mac deployment. App/runtime/imsg artifact/source admission and an independent outer process watchdog still block live measurement. [Registration boundary](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-11 session watchdogs

The joined runner now aborts at a whole-cycle deadline and bounds cleanup observation with a shared watchdog. Revocation precedes concurrently initiated transport/source/gate/app close; unacknowledged cleanup remains false, samples are discarded, and late completion cannot upgrade the returned failure report. Five new timeout/fault tests; full suite 146 passed on Node 24.19.0, typecheck passed on Node 22.23.1. This is not an OS exit guarantee: an outer owned-process/listener watchdog, artifact/startup admission and real child registration still block live use. Production unchanged/stopped. [Limits and evidence](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-11 joined isolated session

Implemented one-cycle orchestration for an already-owned loopback app: local session issuance, bounded authenticated GETs, revocation first, joined transport/source/reader cleanup, and app closure. Samples are discarded on any cleanup failure. Eight new integrations include actual Node RPC children and HTTP in the same run, forced bootstrap rejection and mid-history abort. All 141 tests pass on Node 24.19.0; typecheck passes on Node 22.23.1. Production untouched. Outer artifact/startup admission, real spawn registration, bounded whole-run/cleanup supervision, signal wiring and parity/C06 remain pending. [Runner boundary and evidence](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-10 owned-reader gate

Implemented an experimental exact-handle lifecycle gate: forced/unexpected exit and signal attempts reject an arm and prevent bootstrap replacement. Bounded cleanup includes constructor-orphan children and reports missing close acknowledgement as failure. Two native integrations plus five standalone fault tests pass; full suite 133 passed on Node 24.19.0 and typecheck passed on Node 22.23.1. No production source change or Mac execution. Registration remains test-local: a reviewed real constructor adapter, artifact/listener admission and joined session/transport/process supervision are still required before live measurement. [Implementation boundary](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-10 native source lifecycle tests

Three new tests exercise production LiveSource/ReadonlyRpcClient with real synthetic Node children: bootstrap closes before reopening, stuck history is interrupted and the owned child closes, and forced bootstrap exit is distinguished from normal exit. Full suite: 131 passed on Node 24.19.0; typecheck passed on Node 22.23.1. Important supervisor requirement: source.close resolving is not sufficient for a clean measurement, because existing RPC close accepts confirmed forced exit. Capture exit code/signal and signal attempts for every child and reject such arms. No runnable experiment supervisor or production changes yet; no Mac execution. [Evidence and next implementation requirements](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-10 bounded loopback transport

Added GET-only measurement transport restricted to literal loopback and workload paths, with absolute request deadlines, byte/header bounds, redacted failures, no redirects/retries, and awaited local socket closure on abort/close. Seven synthetic transport tests and all 128 application tests pass on Node 24.19.0; typecheck passes on Node 22.23.1. The workload now also has an authenticated real-loopback integration test. Local connection cleanup is not proof of upstream RPC cancellation or child exit. Next remains exact-owned process/listener admission and lifecycle supervision, then parity/review/live gates. No Mac or production changes; production remains stopped. [Evidence and boundaries](docs/nonlaunch-api-workload.md).

## Latest update — 2026-09-10 authenticated workload integration

The nonlaunch workload now has four synthetic integration tests through the actual application routes/authentication/serialization: success and logout, revoked-session rejection without dispatch, revocation during pending history, and redacted upstream failure. Full suite: 127 passed on Node 24.19.0; standalone helper: six passed; typecheck passed on Node 22.23.1. No production/UI changes or remote execution. This does not test TCP deadlines or owned RPC exit; bounded loopback transport and process supervision are still required before live use. See [integration evidence and limits](docs/nonlaunch-api-workload.md). Production remains stopped.

## Latest update — 2026-09-10 API workload preparation

Added a transport-free, fail-closed API cycle helper with six synthetic tests passing on Node 22.23.1 and 24.19.0. It emits only fixed categories/counts/timings and never claims C06 acceptance. No application/production changes or remote execution. [Preparation and remaining integration gates](docs/nonlaunch-api-workload.md) records the missing authenticated transport, artifact admission, cross-arm raw identity/parity, owned-child supervisor and independent review. These are still required before live measurement; the helper alone is not a runnable Mac harness.

## Latest update — 2026-09-10 Web polling safety

Automatic CLI status was removed from Web LiveSource before isolated API measurement. Basic reads retain RPC/DB checks; advanced read/typing now honestly report unknown with STATUS_PROBE_DISABLED and explanatory UI text. 123 tests passed on Node 24.19.0; typecheck/build and 10 browser tests passed. Exact pinned Node 24.20.0 and live Mac validation remain pending. See [implementation and next experiment boundary](docs/nonlaunch-status-result.md). This supersedes the next-step entries below: prepare a new reviewed application/API harness; do not reuse a342425's CLI-injecting diagnostic workload. Production remains stopped.

P0a/P0b readonly core/UI are implemented. P0c deployment remains stopped; no production Tailscale route or permanent Agent. Latest application artifact on both Macs is a342425. This checkpoint adds diagnostic tooling and evidence, not a performance fix or upstream imsg change.

## Completed

- Dedicated Node Full Disk Access restored M1 Agent reads; SIP stays enabled.
- Both prior30-minute runs completed, but preliminary3s API-cycle p95 guidance was exceeded (Intel3.834s/M15.282s).
- Bounded stage profiling of loopback HTTP and existing RPC/CLI calls: foreground and default/Interactive temporary Agents. All temporary runs ended with successful revocation and normal shutdown; both Serve configurations are still empty.
- Delay is mainly inside imsg chats.list/messages.history response waits. Interactive scheduling alone did not establish a sufficient fix and was not adopted permanently.
- Recorder/review packet/raw sanitized Agent measurements and dispositions are in [performance diagnosis](docs/performance-diagnosis.md).
- Latest verification: typecheck passed;118 existing tests and7 diagnostic-helper tests passed. Production src/web and installed imsg unchanged.

## Next work, in order

1. Exact-owned-child profile corrections were reviewed and both Macs completed idle/chats/history sampling with target/handler validation and confirmed owned-process shutdown. Raw reports stay private; fixed-category findings and review dispositions are in [owned-profile results](docs/owned-profile-results.md). Five profile-helper tests pass; full supervisor fault injection is not claimed.
2. Both active profiles contained Contacts authorization frames, unlike idle. This identifies an optimization candidate, not exclusive causality or a performance pass. Review the [neutral alternatives packet](docs/owned-profile-review-packet.md) and ask the owner whether an isolated custom-imsg build experiment is in scope before beginning it. Installed binaries remain unchanged; no build/patch execution is authorized yet.
3. Based on measured evidence, prepare and independently review a minimal fix. Any upstream fork/replacement or changed data/freshness contract needs a separately scoped implementation decision; no such change is currently selected.
4. Rerun controlled/counterbalanced comparison and original20-sample/30-minute performance checks. Do not change the original measurement definition or claim the six-sample experiment is C06 acceptance.
5. Complete P0c active/crash lifecycle, release-path switch, actual Tailscale HTTPS/network/browser, owner-key and phone handoff gates before production readiness.

Review capacity: the independent diagnostic reviews completed; a later Sol internal-source task hit a usage limit and returned no result. Direct Claude review remains unavailable; neutral Markdown handoff exists. Account-wide remaining quota is not exposed by the available tools; no remaining-token estimate is assumed.

Private machine paths, retained temporary states and detailed restart context are recorded in the owner's Vault project note, not in this public-safe file. No push/publication or OS reboot performed. Preserve unrelated worktree edits.
# 2026-09-10 isolated candidate access checkpoint

Both custom imsg candidates completed one read-only chats.list(limit=1) through the reviewed standalone supervisor and exited normally without TERM/KILL. See `docs/custom-read-preflight-record.md` for artifact digests, individual review dispositions, synthetic/native checks, and limitations. Linux supervisor suite: 22 passed; Mac checks covered equivalent lifecycle cases and platform-specific follow-ups. No application runtime/deployment changes. C06 is still unaccepted; next phase is matched release baseline/candidate measurement. The independent review usage-limit interruption is recorded; no result is inferred from that attempt.

## 2026-09-10 release comparison completed

The previously pending release comparison is complete: same-host baseline/candidate ABBAABBA chats.list(limit=50), fresh processes, all four pairs matched on each Mac. Response medians Intel1051→269ms, M1785.5→361ms; total lifetimes also improved. Both versions returned the same names within each host, but Intel returned no optional names whereas M1 returned15 named rows. Twenty total preflight/sample children closed cleanly. See `docs/release-comparison-record.md` for every sample, artifact provenance, review dispositions and limits. Seven comparison tests pass on both Macs; experimental upstream patches are preserved under `experiments/contact-batch/` and checked against pinned bases.

Current next step supersedes the earlier approval/build-pending entries: continue isolated persistent-RPC/history verification, followed by the original Agent/API C06 gates. No candidate adoption or production service change yet. Cold-process list results are not C06 acceptance.

## 2026-09-10 persistent history comparison completed

ABBA history sessions completed on both Macs with matching target/payload/names and clean child shutdown. Intel steady session medians A521/497ms vs B72/70ms; M1 A650/613ms vs B115/101ms. Lookup workloads were nonzero; populated names were retained on M1. Full samples and review decisions: `docs/persistent-history-record.md`.39 local regression tests and10 history-specific tests per Mac passed. Next is isolated application/Agent C06 planning, not permanent fork adoption or production restart.
