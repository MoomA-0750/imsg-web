# P0b review disposition

2026-09-08. Neutral packet: `p0b-review-packet.md`. No raw conversation or private exports in the packet. Four fresh design reviewers received the same requirements/plan without prior reasoning or conclusions. Lead judged findings against requirements, not by vote.

## Design review

| Group | Findings | Disposition |
|---|---|---|
| Requirements6 | Old DB handle/new epoch; cross-resource stale results; rotate partial failure; numeric limits; map overflow; name/null metadata | All adopted: retire/open ordering, common generation, fail-closed re-rotation, numeric bounds, epoch reset at2001, nullable metadata |
| Simplicity3 | Remove admin socket; duplicate caches/queues; undefined map overflow | Socket removal rejected: live revocation and ownership interface retained for subsequent phases. Other2 adopted: serial source, no RPC status cache, CLI30s only, bounded map reset |
| Security/operations5 | Old DB handle; byte bounds; partial rotation; bounded shutdown/lock; clear all private UI state | All adopted; overlapping findings consolidated by requirement, not counted as votes |
| Acceptance5 | Numeric limits; rotation states; post-logout response; sharing/map boundary; missing shutdown AC | All adopted, explicit B08 and fault assertions |

No unresolved high-impact disagreement on this read-only slice. Uncertain-send override is a separate unanswered user decision and is not inferred from permission to continue.

## Implementation and review

Lead owned core auth/owner/admin/HTTP/DB lifecycle/build/integration, high-risk tests and browser assertions. Sol owned exactly5 new web files on a fixed typed interface; isolated/reversible UI justified delegation. Independent acceptance reviewer authored only `web-auth.test.ts` and `web-http.test.ts`, then lead checked assertions. Terra was not used for core or acceptance design. No overlapping edit ownership; later quota interruption caused lead to finish UI/test integration.

| Finding | Decision and proof |
|---|---|
| C1 high: release lock while rotation still writes | Adopt: track rotation during shutdown, retain marker at deadline; actual Unix socket/held-write tests, including late completion |
| C2 high: load stale owner hash before lock | Adopt: authoritative load after exclusive lock; stale Auth startup regression |
| C3 medium: hide HTTP stop failure | Adopt: bounded force-close verification, report failure and retain marker; injected HTTP close rejection |
| C4 medium: forget unconfirmed CLI stop during final close | Adopt: propagate source failure through final close; injected CLI SHUTDOWN_FAILED |
| C5 medium: missing admin status/CLI | Adopt: closed status response, auth status/revoke-all/rotate |
| F1 medium: missing established DB503 violates409 contract | Adopt: distinguish initial failure from lost identity; real unlink and old-ID assertions |
| F2 medium: logout recovery advice fails to revoke original session | Adopt: accurate local revoke-all guidance; aborted DELETE test proves original cookie remains valid |
| F3 medium: browser assertions don't prove sent limit or response concurrency | Adopt: observe outgoing limits through1000, hold response unresolved across focus/45s, assert no extra requests and next single cycle |

A fresh final reviewer inspected the neutral packet and limited code, not previous review records. It returned F1–F3. After fixes, its bounded read-only reinspection found **no remaining defect within those three findings**; it did not execute tests. Tests were executed by lead. This is not a claim of bug-free software.

Lead integration additionally fixed initial DB bootstrap identity race, duplicate focus poll loops, late401/new-login and delayed logout ordering, stuck busy state after epoch reset, misleading unknown/unread and key-storage labels, Vite root hiding all tests, mobile pane height collapse and hover contrast. Browser assertions and synthetic screenshot inspection cover UI fixes. No external mutation was used to test them.

Claude Opus design invocation was one-shot, no tools, safe mode, no persistence, only packet on stdin; organization subscription access disabled caused exit1. No Fable/router/settings changes. No Claude code review result was obtained. `p0b-review-packet.md` can be handed off as-is with its explicit limited read-only code-review scope.

Evidence: `p0b-acceptance.md`. Repository remains local/unpublished; no production service or remote push authorized by these reviews.
