# Development checkpoint — 2026-09-12

## Ownership and current state

Primary implementation responsibility transfers from Codex to Claude Code on
2026-09-12. Start with `AGENTS.md` and `docs/CLAUDE-CODE-HANDOFF.md`. Production is
stopped. No push/publication, Mac work or new application implementation occurred
during the handoff session.

P0a/P0b authenticated read-only chats/history and responsive UI are implemented.
The owner exercised the synthetic preview from another PC and phone: offered
operations worked and synthetic data appeared in expected locations. This is not
approval of final behavior/design or evidence about real Messages data.

## Four-step progress

1. Independent cleanup/sample re-review: **complete for scoped synthetic code**.
2. Exact app/Node/imsg and launch admission: **complete** (Phases A-F).
3. New real-data parity and C06/API/Agent measurement: **in progress**. Real
   `chat.db` opened read-only with nothing modified; contact resolution working
   in both the SSH and LaunchAgent contexts through a local explicit-source
   patch; parity baseline-vs-candidate **EQUAL** on 25 chats and 125 messages
   with phone-derived name resolution confirmed; RPC-level timing shows the
   candidate **68% faster** on the warm cycle. C06 itself — the full
   authenticated API cycle, p95 and RSS over 20 samples / 30 minutes — is
   **not started**. See `docs/step3-*.md`.
4. Owner report, fork/deployment decision and limited trial: **not started**.

Step2 completed locally: fixed imsg0.14.2/0.15.1 source paths and stored patches
rechecked; RPC no-launch path and its IPC writes documented; SSH-vs-Agent Contacts
source difference identified; official Linux Node24.20.0 checksum matched. Exact
Node24.20.0 fresh build, typecheck,59 nonlaunch tests and149 app tests passed.

Re-verified independently by Claude Code on 2026-09-12 on this Linux workstation,
with no Mac access and no live data: pinned Node24.20.0 archive still matches the
official SHA256; `npm ci --ignore-scripts` from the exact lock, typecheck,149 app
tests and59 nonlaunch tests all pass; the pinned upstream worktrees are still at
c99e6d0/646ea7a and both stored contact-batch patches still apply. The predecessor's
step2 completion claims are confirmed rather than assumed. `npm run test:browser`
was not rerun in this session.

Phase A pass 1 (read-only discovery on both Macs) ran on 2026-09-12 with owner
authorization and **stopped on its own abort conditions**. imsg was not invoked
and no dedicated Node was executed; nothing was created, moved, deleted or
signalled. The M1 host's stock imsg is now **0.15.3**, not the
audited 0.15.1. Source assessment in `docs/imsg-0153-upgrade-assessment.md`
finds all nine audited files byte-identical, the changes confined to the
launching path, and the stored patch still applying; re-pin to 0.15.3 rather
than revert, which is also no longer locally possible. The Intel host runs a
foreign long-lived imsg process belonging to a separate message-bridge system of
the owner's, whose three agents are loaded and which injects the bridge into
Messages at each login; the owner has authorized stopping it for a bounded
window at measurement time. Serve is empty on both hosts (pass 1's
"unestablished" on Intel was a probe error, since withdrawn). The M1 build tree
was not found. See `docs/step2-phase-a-result.md`.

Phase B pass 2 completed 2026-09-12, read-only, imsg and Node still not executed.
Both Node runtimes are now bound to their official release images by digest. The
published Intel candidate digests turned out to come from the tree named
`candidate-r3`, not `candidate`; the latter is a superseded dead end. None of the
Intel trees is a git repository, so binding is by file content only. The
re-resolved 0.14.2 lock's contents were read for the first time and add csqlite
plus sqlcipher.swift, the latter absent from upstream's own complete lock at
0.15.4 for reasons not established. Toolchains differ (Intel Swift 6.1.2 on CLT;
M1 Swift 6.4 on an Xcode 27 beta) and both hosts have room for fresh build
trees. See `docs/step2-phase-b-result.md`.

Step2 Phases A through E are complete as of 2026-09-13. Read-only inventory of
both Macs (A), provenance classification (B), the trusted environment contract
implemented in code with tests that fail when it leaks (C), rebuild under
observation of baseline and candidate at v0.15.4 on both hosts (D), and native
/helper/IPC closure (E). **imsg has still never been executed by this project.**

The four class-R products are the only artifacts that may be measured. As of
2026-09-13 these are the **rebuilt** set carrying the explicit contact-source
patch, and they supersede the first set:
Intel `f18c906b…`/`fb78b375…`, M1 `00983e9f…`/`47794c68…`. None has been run.
The superseded set (Intel `f825229b…`/`52a23596…`, M1 `ed0ad126…`/`3207be3b…`)
still exists on both hosts and was not removed. See `docs/step3-rebuild-result.md`.

What step2 leaves for later, deliberately: the first execution of a built
product is its own phase with its own authorization, created because Phase C and
Phase D had referred to each other in a way that could have let a first run
happen with no approval point passed. A self-built binary does not inherit the
stock binary's permission grants, so that phase may require the owner to grant
access at the desktop by hand.

## Recent substantive commits

- `dfedc73` documents pinned source audit and exact Node24.20.0 verification.
- `f0cebb5` closes the public sample-admission bypass found by Claude re-review.
- `69e03bb` adds a synthetic-only tailnet UI preview and checks.
- `c82d06e` fixes reader/client cleanup acknowledgement and startup fallback cleanup.

The application-code head remains `f0cebb5`; later commits are documentation and
agent instructions. Claude review is now available and completed for step1. Older
statements saying direct Claude review is unavailable or numeric export/review is
the next task are superseded by this file and the handoff.

## Safety-critical reminders

- Never use `npm run doctor` for no-launch verification.
- Never reuse/repoint a342425's `scripts/diagnose-performance.mjs`.
- Resolve Intel Homebrew `bin/imsg` wrapper to its versioned libexec image.
- Never touch or reason from a local copy of the iMac's running `watcher.py`;
  never broadly kill `imsg` processes.
- Do not change stock imsg, global Node, SIP/TCC, Messages, permissions, existing
  watchers/Agents, Serve/Funnel or stale lock/socket state without explicit scope.
- Lifecycle success/sample validation is not source provenance, live parity,
  safe-to-release, C06 success or production approval.

## Primary records

- Full handoff: `docs/CLAUDE-CODE-HANDOFF.md`
- Step1: `docs/nonlaunch-rereview-2026-09-12.md`
- Step2 checkpoint: `docs/nonlaunch-source-runtime-audit.md`
- Step2 Phase A plan: `docs/step2-phase-a-inventory-plan.md`
- Step2 Phase A result: `docs/step2-phase-a-result.md`
- imsg 0.15.3/0.15.4 assessment: `docs/imsg-0153-upgrade-assessment.md`
- Step2 Phase B plan and result: `docs/step2-phase-b-provenance-plan.md`, `docs/step2-phase-b-result.md`
- Step2 Phase C launcher/environment: `docs/step2-phase-c-launcher-plan.md`
- Step2 Phase D build plan and result: `docs/step2-phase-d-build-plan.md`, `docs/step2-phase-d-result.md`
- Step2 Phase E closure: `docs/step2-phase-e-closure.md`
- Workload/process boundaries: `docs/nonlaunch-api-workload.md`,
  `docs/nonlaunch-worker-watchdog.md`, `docs/nonlaunch-residue.md`
- Artifact verifier: `docs/nonlaunch-bundle.md`
- Historical candidate evidence: `docs/release-comparison-record.md`,
  `docs/persistent-history-record.md`, `docs/custom-read-preflight-record.md`
- Deployment/C06: `docs/p0c-operations.md`, `docs/p0c-acceptance.md`
- Private paths/environment inventory: owner's Vault project subnote, not this repo.

No current code change is waiting uncommitted. Always check status and preserve
user changes. Do not push unless the owner explicitly approves the exact content.
