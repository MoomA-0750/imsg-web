# Review and implementation record

## Design review, 2026-09-07

Four independent no-history reviewers checked requirements/edge cases, simplicity, security/operations/performance, and testability. A separate Claude Opus reviewed the neutral requirements packet in one-shot safe mode, with no tools or session persistence. No Fable or fallback routing. The lead adjudicated findings, not by vote. Full original user quotes and the neutral plan are retained in the private project review packet, outside this public-safe code tree.

P0a fixes adopted: close the read-only child on dispatched timeout/abort; prevent a timed-out subscription from allowing another one; explicit queue overflow error; fixed capability truth table/reasons; skipped empty-history and unverified notification distinctions; dedicated Node24 as a P0a prerequisite; synthetic-value fixture rules. No reviewer found a need to block all P0a work.

Deferred to their implementation gates: mutation recovery choice, canonical send target hashing, separate operation progress/execution states, session-expiry stream cancellation, performance baselines, watcher coexistence measurements. No send implementation is authorized by a successful P0a check.

Alternative review proposals not adopted: require architecture-specific JS builds (the JS is portable and Node is separately architecture-specific); count a SIP-enabled environment with permanently disabled basic sending as successful (the basic-send requirement is retained); automatically delete a newly referenced upload on a duplicate request (may be shared by another live operation). Do not infer safety from those proposals.

## Task ownership

- Lead: initial skeleton, RPC lifecycle, adapter, capability rules, doctor, capability/adapter assertions, integration, real-device validation. Rationale: uncertain external contract, cross-cutting effect, no existing tests; keeping these together reduces integration risk.
- Sol: `tests/rpc.test.ts` and `tests/fixtures/fake-imsg.mjs` only. Rationale: independent acceptance assertions against a fixed interface; isolated files, reversible changes, low integration risk. Lead inspected assertions and requested corrections instead of weakening expected behavior.

No production host configuration or message data is embedded in this repository. Code review and final test evidence will be recorded below before the P0a handoff.

## Code review

Claude Opus code review could not run: the provider returned that the organization disabled Claude subscription access for Claude Code. Authentication/organization settings were not changed. `docs/code-review-packet.md` remains the handoff packet. This is not recorded as a completed Claude code review.

A separate no-history reviewer read only the scoped source/tests/specifications. All three current blockers were adopted and fixed:

| Finding | Resolution | Regression evidence |
|---|---|---|
| Concurrent unsubscribe ACK can clear a newly created subscription | Coalesce unsubscribe into one in-flight Promise | adapter concurrent-unsubscribe assertion |
| Hard shutdown deadline rejects but inherited pipes still keep host alive | Destroy owned stdio and unref direct child on failure; never kill grandchildren | subprocess inherited-pipe test plus direct destroyed/unref assertions for RPC and CLI |
| CLI shutdown failure can still report doctor ready | SHUTDOWN_FAILED is fatal to readiness; ordinary CLI capability failure still degrades independently | doctor CLI-failure readiness assertion |

Static re-review confirmed all three implementation defects resolved and found no new major code defects. It correctly identified that the first inherited-pipe test alone also passed old code; direct pipe-destruction/unref assertions were added rather than treating that test as sufficient. Final run:43 passing assertions across6 test files. The independent Sol test author later hit a usage limit; the lead completed the final test corrections and verified assertions.
