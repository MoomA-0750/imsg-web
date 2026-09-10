# Persistent RPC history experiment

## Relevant user requests (verbatim)

> 両方で検証はしてほしいです
> 続けてください

## Requirements and constraints

Validate isolated baseline/candidate release artifacts on both Macs using existing grants and real SSH environment. No sending, read-state changes, attachments/conversion, database writes, signature/TCC/SIP changes, installed dependency replacement, launchd or Serve changes. Preserve content confidentiality and bounded direct-child cleanup. This stage is experimental; it cannot establish Agent/API C06 or authorize fork adoption.

## Plan and interfaces

Extend the existing private one-child probe with one fixed history scenario, keeping the current list-only behavior. A child receives chats.list(limit50), then messages.history(chat_id=selected,limit50,attachments=false,convert_attachments=false) four times sequentially on the same stdin/stdout connection. The first history is a warmup; the next three are measured. No generic CLI-specified RPC method or arbitrary parameters.

The first A session selects the first direct chat (is_group=false) from chats.list; its positive safe-integer local ID remains in memory and is used for all sessions on that host. Other sessions must find the same ID as a direct chat in their chats.list results. No target means stop with an explicit no-target result; do not silently select another chat. No chat ID is printed or persisted. Host-local target IDs need not match across Macs.

Run sessions ABBA (two disjoint A/B pairs) sequentially; each session uses one fresh child, four histories on that connection. Verify binary SHA256 before every session; no build activity during measurements. All eight sessions across both hosts are readonly. First-history and subsequent-history timings are reported separately; timing is request-write to complete validated response, with total child lifetime separately recorded. Do not mix three samples from one session with three independent processes or claim p95.

## Parsing, model and lifecycle

Fixed unique string IDs distinguish discovery/history0/history1/history2/history3. Validate JSON-RPC2.0, expected ID, result-only envelope, array<=50, positive safe row IDs, optional string sender/contact names, reaction arrays with optional string names. A bounded frame is1MiB and total stdout8MiB. Stderr, malformed/extra/duplicate/wrong-ID output, failed target matching, protocol or access error fail closed. Finish success only after all five responses and clean exit0 with no extra bytes. Keep the reviewed signal/TERM/KILL/close-timeout policy. Add a90s overall deadline; every request15s maximum. Clear request timers after each response.

The history response is consumed only by an in-memory observer: canonical non-name payload and name presence/value at exact paths get HMACs under a fresh host-run key. Keys/fingerprints/content never enter output. Across a pair, require the same chosen target and identical ordered payload/names for corresponding warmup and measured histories. Any mismatch excludes the pair from comparison. A failed session stops that host and emits an incomplete report; completed timings remain descriptive. Matching empty histories yield no attributable comparison. Only counts, request timings, fixed outcome, verified executable hashes, and pair-match booleans are reported.

## Acceptance tests

- H1: exact five-request sequence, fixed flags/target, default list mode unchanged. No overlap: max one outstanding request.
- H2: warmup excluded from steady measurements; per-request timing excludes prior request delay. Separate total lifetime.
- H3: missing/changed/group target, empty history, wrong ID, extra frame,51rows, malformed reaction, late stderr/nonzero close all cannot pass.
- H4: timeout after discovery or midway through histories closes only the owned child; request and overall timers cancel, repeated signals settle once.
- H5: name-only/message/reaction changes invalidate pairs; reordered JSON object keys match; raw stdout/stderr and final report contain no message/name/target/key/fingerprint.
- H6: failed sessions stop subsequent sessions; matching nonempty pairs compare only their steady timings, reported per session rather than independent samples.

## Alternatives and review

Standalone CLI history per process would not test persistent connection/cache behavior. Building a generic RPC framework is outside this scope. Existing deployed app clients enforce stock paths and are not used here. The lead owns the cross-cutting protocol/lifecycle changes.

Review for rejection reasons: requirements/edge cases, simpler alternatives, security/operations/performance, tests/acceptance. Read only, no edits or Mac access. This packet is also the tool-free nonpersistent Sonnet/Opus fallback; no Fable or automatic routing.

## Clarifications

Empty history is a valid session, but any empty warmup/measured history excludes its pair. Count incoming messages plus incoming reactions; if any history has zero such lookups, exclude its pair from optimization comparison. No automatic target reselection. Each session reports warmup separately and median/min/max of its three steady requests. Completed eligible pairs remain eligible if a later session fails; the report also says incomplete and makes no overall-run acceptance claim.

History array key is messages. Each message requires positive safe-integer id, boolean is_from_me, and an array reactions. Each reaction must be an object with boolean is_from_me. Optional message sender_name/contact_name and reaction sender_name/contact_name must be strings. These four exact name paths are split into name fingerprints; sender addresses, IDs, text and every other field remain in the non-name fingerprint. Confidentiality applies to parent/harness stdout/stderr and persisted reports; RPC pipe contents necessarily contain the data in memory.

Before live use, inspect both pinned versions' handlers and payload-building calls for accepted false attachment/conversion flags and absence of mark-read/mutation calls. The overall timer is a secondary bound; five sequential15s requests normally imply a tighter75s request bound. Synthetic tests can shorten the overall timer to exercise it without claiming a natural five-request path exceeding90s.
