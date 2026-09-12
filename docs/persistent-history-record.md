# Persistent history experiment record

## Review decisions

Two independent reviewers received the neutral persistent-history-review.md and then code/tests. No edits or Mac access were delegated. Lead owns the protocol/lifecycle integration. Both reviewers found no concrete runtime blocker in the reviewed implementation; one independently ran the then-current36 tests successfully. Direct Claude review was unavailable when this experiment was recorded; the neutral packet remains this experiment's handoff. Superseded 2026-09-12: direct Claude review is available and was used for step1; see `STATUS.md`.

| Finding | Disposition and reason |
|---|---|
| No version-specific proof of readonly/attachment flags | Adopt. Both pinned RPCServer+Handlers parse attachments/convert_attachments booleans. False attachments bypasses store.attachments in buildMessagePayload. Both MessageStore constructors use SQLite readOnly; inspected history and payload paths invoke no mark-read or mutation method. |
| Empty history contradictory | Adopt valid session/ineligible pair if any of its four histories is empty. No target reselection. |
| Prior matched pair after later failure unclear | Adopt retaining that completed pair as a partial comparison with complete:false; no overall-run acceptance. |
| Name paths/schema underspecified | Adopt message sender_name/contact_name and reaction sender_name/contact_name only. Keep sender addresses and all other fields in non-name equality. Validate boolean is_from_me, reactions array, and every message chat_id equals the selected target. |
| No useful Contacts workload may be exercised | Adopt incoming-message plus incoming-reaction count; any zero-lookup history makes the pair ineligible. |
| Statistic/clock unclear | Adopt one warmup, median/min/max over three steady requests per session, no pooling of dependent requests. Delayed discovery/history fixture checks clock reset. |
| One outstanding request not proven | Adopt delayed-response fixture with an outstanding flag; fail on pipelined request. |
| Parent output confidentiality untested | Adopt actual subprocess harness for success/failure; capture stdout/stderr, reject content markers, target fields/ID and HMAC fingerprints. |
| History-specific boundaries missing | Adopt50/51 messages, invalid message/reaction booleans, oversized history, actual outgoing-only workload counter. |
| Response timestamp precedes reaction validation | Adopt moving timing after full accepted row/reaction validation. |
| Oversized unterminated remainder after valid line | Adopt checking residual buffer after the loop; total8MiB bound retained. |

Five sequential request deadlines (15s each) normally precede the secondary90s session bound. The overall-timeout fixture shortens that timer rather than inventing a natural>90s five-request path. Existing direct-child shutdown/revocation limits still apply, including no unconditional cleanup guarantee after parent SIGKILL.

## Validation and state

Final local regression:39 tests passed across the preflight, list comparator and history comparator. Final history-specific10 tests passed on each Mac. The release artifacts remain those in release-comparison-record.md; no source/build changes were made during this stage.

## Live result — 2026-09-10

Both hosts completed ABBA. All eight children closed exit0 with no TERM/KILL; all four disjoint pairs across hosts matched all corresponding warmup/steady history payloads and optional names. No body, address, chat ID, name or HMAC value was persisted.

| Host/session | Arm | Warmup ms | Steady requests ms | Session median ms | Total lifetime ms |
|---|---|---:|---|---:|---:|
| Intel1 | A | 532 | 506,521,536 | 521 | 3119 |
| Intel2 | B | 87 | 79,72,71 | 72 | 609 |
| Intel3 | B | 79 | 70,68,74 | 70 | 607 |
| Intel4 | A | 482 | 532,496,497 | 497 | 3002 |
| M1-1 | A | 779 | 650,618,780 | 650 | 4013 |
| M1-2 | B | 118 | 123,113,115 | 115 | 818 |
| M1-3 | B | 113 | 101,97,103 | 101 | 786 |
| M1-4 | A | 661 | 653,608,613 | 613 | 3242 |

Each Intel history had33 messages,0 named messages,21 incoming-message/reaction lookup opportunities. Each M1 history had50 messages,29 named messages,31 incoming-message/reaction lookup opportunities. Thus both exercised lookup work, while successfully populated names are demonstrated on M1, not Intel. Session lifetime includes discovery and all four histories and is not an individual-request latency. Dependent requests are not pooled as independent samples.

Measured diagnostic SHA256: preflight `b89d63ab9b9496354970915895d48b67b3d9d3792b3469db429b1b9202ad09f3`; imported list comparator `8e45579320c570ca6ce761c6471a7d5c7e6a5fb1b7b2096ecffbf8a9c14ac45b`; history comparator `af9faf5b87acc37f036142520d71633a9e0e9f07ecba0a52fcbce5db1bd28777`. Binary digests were verified before each session and equal the release-comparison artifacts.

This supports faster repeated history reads under the tested SSH conditions without observed payload changes. It is not C06: no production Agent, Tailscale HTTP/browser,30-minute stability or user-facing application path was exercised. Installed imsg and service state remain unchanged. Next examine an isolated application-level measurement plan; do not infer permanent dependency adoption from this result.
