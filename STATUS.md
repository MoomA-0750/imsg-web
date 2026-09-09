# Development checkpoint — 2026-09-09

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
