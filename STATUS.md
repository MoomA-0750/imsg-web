# Development checkpoint — 2026-09-09

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
