# Claude Code handoff — 2026-09-12

This is the public-safe, conversation-independent handoff. Read `AGENTS.md`, then
this file, then `STATUS.md`. Private machine paths and retained artifacts are in
the owner's Vault note referenced below and must not be copied into this repo.

## Goal and current product state

Build a single-owner self-hosted Web UI over imsg, ultimately reachable through
the owner's tailnet. P0a/P0b implement authenticated read-only chats/history and
a responsive UI. Production is stopped. No permanent Serve route or production
LaunchAgent is active. Sending, read-state changes and typing are not integrated.

On 2026-09-12 the owner exercised every offered synthetic-preview operation from
a separate PC and phone and saw no apparent frontend malfunction. Interpret this
only as: synthetic data appeared in the expected list/detail locations and basic
login, selection, paging, mobile back navigation, empty state and logout worked.
It is NOT approval of normal-use behavior, final visual design, real-data mapping,
or product requirements. The owner has future behavior/appearance preferences
that were deliberately not collected during this functional check.

## The four-step sequence

1. **Independent re-review — complete for its stated scope.** Claude Opus reviewed
   owned-reader shutdown, startup fallback cleanup and the v2 numeric sample path.
   Two cleanup findings were fixed. A second review found a sample-admission bypass
   in the public lifecycle supervisor; it was fixed and focused re-review found no
   remaining scoped blocker under trusted factory/startup assumptions. See
   `docs/nonlaunch-independent-review-2026-09-11.md` and
   `docs/nonlaunch-rereview-2026-09-12.md`.
2. **Exact app/Node/imsg and launch-condition admission — in progress.** Fixed
   upstream sources and stored patches were rechecked, and exact Node24.20.0 local
   verification passed. Remaining work is detailed below. This is the immediate
   next step.
3. **Real-data correctness and performance — not started for the new API
   artifact.** After step2, run a separately authorized, isolated same-host
   baseline/candidate comparison: identical raw target, ordered payload and names;
   then counterbalanced20-sample and30-minute C06/API/Agent checks. Historical
   cold-process and persistent-history comparisons support the batch candidate,
   but are not this new application measurement and cannot be relabeled.
4. **Owner decision and limited real-data trial — not started.** Report parity,
   performance, cleanup and remaining operational limits. Obtain explicit owner
   approval before fork adoption, production restart, Serve/Agent changes or real
   user handoff. UI/product preferences still need a separate conversation.

## Step2: completed and remaining work

Completed:

- Re-fetched upstream commits c99e6d0 (0.14.2) and 646ea7a (0.15.1), read their
  repository instructions, and confirmed both stored contact-batch patches apply.
- Audited default RpcCommand, RPCServer/status, database resources, MessageStore,
  Contacts sources, bridge client/launcher and watcher initialization. RPC uses
  `invokeWithoutLaunching`; ordinary CLI `status` does not.
- Confirmed MessageStore opens SQLite read-only. Chats/history are read paths and
  Web requests set attachments:false. No automatic CLI capability status remains
  in LiveSource.
- Important qualification: an already-ready bridge status probe creates/removes
  IPC request/response files. “Does not launch Messages” is not “zero writes.”
- 0.15.1 detects SSH environment variables and can use a read-only AddressBook
  SQLite fallback. Do not equate SSH name results with LaunchAgent behavior.
- Downloaded official Linux x64 Node24.20.0 archive, matched SHASUMS256, and ran
  fresh build, typecheck,59 nonlaunch tests and149 app tests successfully. No
  global runtime was changed. Darwin archive hashes in earlier records still
  match the official checksum file. See `docs/nonlaunch-source-runtime-audit.md`.

Remaining, in this order:

1. With fresh owner authorization for Mac access, perform **read-only inventory**
   of both retained Mac environments: exact dedicated Node executables/archives,
   baseline and candidate imsg binaries, source-input and Package.resolved
   manifests, architecture, ownership/mode, code signature, linked libraries,
   helper/dylib resolution and retained app releases. Do not execute imsg yet.
2. Bind every intended executable to reviewed source/build inputs and recorded
   digest. A binary digest alone is identity, not source provenance. Establish
   which old artifacts are merely historical and which will be rebuilt.
3. Define and review a trusted launcher with direct absolute paths, private
   immutable directories, exact cwd/environment and no inherited NODE_OPTIONS,
   NODE_PATH, loader or DYLD overrides. Preserve genuine SSH vs Agent context;
   never fabricate SSH variables to obtain names.
4. Build a fresh application bundle from current source and exact lock for both
   architectures. The old a342425 release and old local b089af5 stage predate the
   current no-launch/sample fixes. Inventory the full tree and obtain an
   independently pinned manifest digest outside the bundle.
5. Complete source/import/native/helper closure and IPC-side-effect review.
   Independently review the exact launcher/environment packet. Only then ask the
   owner to authorize a bounded real-data parity/performance run.

## Decisions and where to read the rationale

- **P0 remains read-only; advanced state is unknown:** automatic CLI status was
  removed because it can enter Messages launch/repair. `docs/nonlaunch-status-result.md`
  and historical request `docs/nonlaunch-status-review.md`.
- **Contact batching remains an isolated candidate:** same-host release and
  persistent-history comparisons showed large improvement while matching ordered
  payload/names in tested cases. It is not adopted. `docs/release-comparison-record.md`,
  `docs/persistent-history-record.md`, `docs/custom-read-preflight-record.md`, and
  `experiments/contact-batch/README.md`.
- **Measurement samples require full admission:** public lifecycle supervisor
  always returns sample:null; only the registered supervisor may return a sample
  after sealed registry, normal closure, absence observation and no final abort.
  `docs/nonlaunch-rereview-2026-09-12.md`, `docs/nonlaunch-worker-watchdog.md`,
  `docs/nonlaunch-residue.md`.
- **Generated inventory is not provenance:** complete-tree verifier is useful,
  but generated pins, mutable path verification and source/import/runtime identity
  are separate. `docs/nonlaunch-bundle.md` and `docs/nonlaunch-source-runtime-audit.md`.
- **The preliminary3s p95 is guidance, not an owner-confirmed SLO:** historical
  C06 did not meet it; do not relax or retrospectively reinterpret it.
  `docs/p0c-acceptance.md` and `docs/performance-diagnosis.md`.
- **Synthetic UI feedback is intentionally narrow:** `docs/demo-preview.md`.
- **Deployment and recovery constraints:** `docs/p0c-operations.md`,
  `docs/p0c-review-packet.md`, and `docs/p0c-acceptance.md`.

## Do not do this

- Do not run `npm run doctor` as a preflight. It invokes CLI status, whose upstream
  path may kill/relaunch/repair Messages and inject the bridge.
- Do not reuse or repoint `scripts/diagnose-performance.mjs`. It is specifically
  tied to a342425 and the removed CLI-status-injected workload. A successful old
  diagnostic is not comparable to the current application.
- Do not treat Homebrew's visible `bin/imsg` path as the executable image on Intel.
  It was a shell wrapper that execs the versioned libexec binary. Resolve and
  verify wrapper content, owner/mode, target and actual image before measuring.
- Do not stop, signal, replace or infer behavior from the owner's iMac watcher.
  The running `watcher.py` differed from a local checkout and contains an AI reply
  branch for trigger-bearing self-addressed messages. Never use the local copy as
  evidence. Do not use `killall imsg` or broad PID/process-name cleanup.
- Do not touch installed stock imsg, global Node, Messages DB, SIP/TCC, permission
  prompts, existing watchers, unrelated LaunchAgents or Tailscale configuration.
- Do not use the old a342425 Mac app as the new measurement artifact. It predates
  the current source and can reach unsafe diagnostics through the old harness.
- Do not call synthetic tests, a generated manifest, PID absence at one instant,
  direct-worker close, or a reviewer statement live approval/C06 success.
- Do not output or commit raw chats, message text, names, IDs, owner keys, cookies,
  database paths, private PIDs/ports/state paths or Mac inventory.
- Do not delete stale lock/socket state or retained evidence automatically. If
  ownership/cleanup is uncertain, remain stopped and ask the owner.
- Do not assume `launchctl bootout` return means shutdown is complete; wait for
  exact parent/children, listener and private state acknowledgements.

## Confirmed versus unconfirmed

Confirmed: P0b UI/API synthetic behavior; read-only application routes and RPC
allowlist; no automatic CLI status from LiveSource; exact-child synthetic cleanup
and fail-closed sample boundary; fixed upstream source call paths; stored patch
applicability; exact Linux Node24.20.0 local checks; historical same-host candidate
parity/speed evidence; all temporary services were reported stopped at the last
Mac checkpoint; no repository push/publication.

Unconfirmed: current bytes/state on either Mac; current watcher/Serve/Agent/process
state after the historical checkpoint; source-to-binary provenance for the next
artifacts; exact launch environment/import/native/helper closure; zero OS/SQLite
writes; prompt absence during concurrent permission changes; Agent-vs-SSH Contacts
equivalence; current raw API target/payload/name parity;20-sample/30-minute C06;
active/crash/reboot recovery; permanent deployment; final specs/visual design.

## Questions requiring the owner later

- When step2 preparation is complete, may Claude perform the read-only Mac
  inventories and later the separately bounded real-data run? This handoff session
  explicitly performed no Mac work.
- If admission and parity pass, should the contact-batch fork be adopted, or kept
  experimental? Present evidence before asking; do not assume approval.
- Is the preliminary3s p95 target acceptable as the trial threshold, or should the
  owner define a different SLO prospectively before C06?
- Before production UI work, collect the owner's deferred normal-use behavior and
  visual preferences. The synthetic preview was not approval of either.
- Confirm desired retention/deletion of private temporary environments only after
  consulting the Vault inventory; do not clean them opportunistically.

## Repository state at handoff

The latest application-code commit is `f0cebb5` (sample-admission bypass fix).
`69e03bb` added the synthetic-only tailnet preview; `c82d06e` fixed cleanup
acknowledgements; `a85fc85` added validated samples. Subsequent commits are
documentation/instructions only. No push was performed. Check `git status` before
work and preserve any user changes.
