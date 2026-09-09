# Owned-process profile — 2026-09-09

The following updates the earlier unexecuted-draft checkpoint. Production deployment remains stopped. Both default user Agents completed a bounded profile using the installed readonly RPC client, dedicated Node24.20.0 and unchanged imsg. Only each newly created imsg child was sampled; no Messages or existing watcher process was targeted. No message send, read-state change, TCC/SIP change, DB modification or installed-binary replacement was performed.

## Evidence and limits

One idle window, one chats.list(50) window and one messages.history(50, attachments=false) window per Mac; sample duration1s/interval1ms. Each active report matched the recorded child/parent and contained positive frames for the requested imsg RPC handler. Target liveness/start identity was checked afterward. Numeric PID attachment retains a check-to-attach race; these checks are not a mathematical guarantee against PID reuse.

Values below are maximum inclusive stack counts within each fixed category, **not CPU percentages, elapsed-time fractions or invocation counts**. Categories can overlap and counts must not be added. Short, instrumented samples do not establish exclusive causality or C06 performance acceptance.

| Host / stage | Contacts authorization | Contacts framework | SQLite | Message metadata | Preferences | IPC wait |
|---|---:|---:|---:|---:|---:|---:|
| Intel / idle | 0 | 0 | 0 | 0 | 0 | 538 |
| Intel / chats | 216 | 216 | 1 | 1 | 0 | 411 |
| Intel / history | 486 | 486 | 2 | 486 | 0 | 495 |
| M1 / idle | 0 | 0 | 0 | 0 | 0 | 727 |
| M1 / chats | 104 | 104 | 2 | 2 | 0 | 398 |
| M1 / history | 212 | 212 | 3 | 212 | 0 | 439 |

Intel's retained reports were reprocessed on that Mac with the corrected call-graph-only parser; resulting category values were unchanged. M1 used that parser from the start. Raw reports never left the private Mac directories. The repository contains only fixed-category summaries, no raw stacks, chat identifiers, message content or contact names.

Observed request latency while sampling: Intel chats2114/history1975ms; M1 chats1699/history1503ms. Sampling perturbs scheduling, so these are not comparable replacement benchmark numbers. Together with the earlier stage timing and fixed-version source, the profiles identify Contacts authorization as a concrete optimization candidate on both SIP configurations. They do not prove that it explains every second of latency or that SQLite contributes nothing.

In the pinned source, each displayName lookup calls snapshot, whose path checks source.authorization; the native source calls CNContactStore.authorizationStatus. displayNames already provides a batch lookup, but RPC payload construction repeatedly uses individual lookups. See the [v0.15.1 ContactCatalog source](https://raw.githubusercontent.com/openclaw/imsg/v0.15.1/Sources/IMsgCore/ContactCatalog.swift) and local pinned sources v0.14.2 c99e6d0 / v0.15.1 646ea7a. This is a source-backed mechanism consistent with the observation, not a completed causal intervention.

## Lifecycle and review dispositions

| Finding | Disposition / evidence |
|---|---|
| Initialization could lose the child before PID discovery | Adopt: capture the actual ChildProcess around exactly one synchronous constructor; restore builtin immediately; drain and await owned-child close even when construction throws. Synthetic spawn-then-throw test passes |
| Unproven sampling overlap / malformed or wrong report | Adopt: exact report child/parent, recognized nonzero call graph and positive requested-handler frame; empty/wrong-target/outside-graph/zero-count assertions pass; both live active stages verified |
| PID reuse/check-to-attach risk | Mitigate with retained handle, parent/image/start identity, target-exit cancellation and post-sample liveness; residual numeric-PID race remains explicitly documented |
| No outer lifecycle enforcement | Adopt exact-label/plist supervisor, bounded polling and owned-job bootout; all recorded parent/imsg/sampler PIDs absent on both successful runs. Failure-injection coverage of every supervisor branch remains pending |
| Homebrew wrapper is not the executed image | Adopt exact pinned wrapper-text check plus trusted same-version libexec and actual comm match. Intel first attempt stopped before creating any report, confirmed child exit; corrected attempt succeeded |
| Summarizer counted metadata outside graph / zero frames | Adopt shared graph boundary and positive counts; regression test passes. Reprocess retained Intel reports privately, without another sample |
| Packet overstated post-sample identity checks | Adopt accurate distinction between pre-sample parent/image/start checks and post-sample handle/start checks |
| Successful static review could imply OS verification | Reject that inference: reviewer did not run Mac tests. Lead verified both live successes separately |
| Stock-versus-patched timing confounds toolchain/signing | Adopt a same-toolchain unmodified rebuilt baseline for any future patch comparison; stock compatibility is a separate check |
| Custom build may have a different signing/TCC identity | Adopt explicit identity and existing-permission/capability checks on both hosts; no new grants or prompt workarounds |
| Revocation promise lacks an observation boundary | Adopt as a blocking design question before any patch approval; pre/post checks cannot guarantee noticing a change after the final check |
| Raw reports confused with exported summaries | Adopt precise wording: only exported summaries have fixed fields; raw reports contain private metadata and remain private |

Independent safety reviewer re-read the scoped fixes and reported no new blocking finding under the approved same-owner/admin trust model. A separate source/alternative review request hit an agent usage limit and returned no review; no assent is inferred. Direct Claude review remains unavailable; [neutral handoff](owned-profile-review-packet.md) is retained. No account-wide remaining quota can be observed with available tools.

## Acceptance mapping

- Fixed outbound readonly methods and private-output contract: lead inspected the isolated main path; parser secrecy/invalid report regression tests pass; exported live summaries contain only fixed summary fields. Raw reports contain private metadata and are retained only on their Mac.
- Child ownership/cleanup: two synthetic constructor tests plus both actual Agent exit0, child-close acknowledgement, exact label bootout and all recorded process absence. Existing watcher was not targeted.
- Active overlap: synthetic handler assertions and all four active live reports true.
- No web listener: profiler starts no HTTP server; port8787 had no listener afterward on either Mac. Both temporary profile labels were absent on recheck.
- Five profile-helper tests pass; these are not complete supervisor fault-injection or security-proof coverage. Existing application gates remain as recorded in P0c acceptance.

## Next decision

No performance fix has been selected or applied. A wrapper-only change can affect request frequency/rendering but cannot remove work performed internally by one stock imsg RPC. A separate, reversible experimental imsg build could test request-scoped batch name resolution without replacing Homebrew binaries. Such an experiment needs explicit scope approval and a neutral plan review before implementation. Long-lived authorization caching, granting additional Contacts access, SSH-environment spoofing and direct Messages SQL writes are not approved alternatives.
