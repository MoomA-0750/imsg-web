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
2. Exact app/Node/imsg and launch admission: **in progress; immediate next work**.
3. New real-data parity and C06/API/Agent measurement: **not started**.
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

Step2 remaining: read-only inventory of both Macs after owner authorization;
source/build-to-binary, architecture/signature/linked-library/helper verification;
explicit trusted cwd/environment and import closure; fresh current application
bundles for both architectures with independently pinned complete-tree manifests;
focused review of the exact launcher. Do not invoke imsg until these pass.

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
- Step2 Phase A plan (proposed, not executed): `docs/step2-phase-a-inventory-plan.md`
- Workload/process boundaries: `docs/nonlaunch-api-workload.md`,
  `docs/nonlaunch-worker-watchdog.md`, `docs/nonlaunch-residue.md`
- Artifact verifier: `docs/nonlaunch-bundle.md`
- Historical candidate evidence: `docs/release-comparison-record.md`,
  `docs/persistent-history-record.md`, `docs/custom-read-preflight-record.md`
- Deployment/C06: `docs/p0c-operations.md`, `docs/p0c-acceptance.md`
- Private paths/environment inventory: owner's Vault project subnote, not this repo.

No current code change is waiting uncommitted. Always check status and preserve
user changes. Do not push unless the owner explicitly approves the exact content.
