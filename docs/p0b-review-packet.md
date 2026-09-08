# P0b authenticated read-only Web UI — independent review packet

Date: 2026-09-08. Review workspace: this `imsg-web` repository only. This packet contains requirements and the implementation contract, not prior reviewers' conclusions.

## Request

Find counterexamples, missing requirements, failure conditions and reasons to reject this implementation. Cover (1) consistency/edge cases, (2) smaller alternatives/over-design, (3) maintainability/security/performance/operations, (4) testability and assertions. For each finding give severity, path/line, violated requirement, reproducible ordering/input, minimal remedy and whether it blocks this slice. No findings is a valid outcome; do not invent issues.

For Claude: use Opus or Sonnet, never Fable or a router that cannot exclude it. Design-only review: one-shot, nonpersistent, no tools, stdin only this text. Completed-code review: restrict reads to this repository's `src`, `web`, `tests`, `browser-tests`, `scripts/verify-readonly-http.mjs`, package/lock/TS/Vite/Vitest/Playwright config, and this packet. Allow file reading/search only; no shell execution, network, writes, credentials, owner state, Messages database, SSH or external changes. Do not read raw conversation or prior review records. If these boundaries cannot be enforced, return a review of this packet only and identify the limitation.

## Relevant user requirements, verbatim

> imsgというiMessageをcliで送受信できるバイナリがありますが、それをWeb UIでラップして、そのWeb UIからiMessageが利用できるようにしたいと思っています、まずimsgがどのようにどのようなことができるかを確認し、それを元に実際の実装方針をどこまでの機能をつけるかを検討してください

> 実際にimsgが入っているmacは2台あり、両方sshで接続可能です、macというエイリアスで、sip有効状態のm1 airに、imというエイリアスで、sip無効のIntel imacに繋がります、imsgはsip有効状態と無効状態で若干使える機能に違いがありますが、どちらの状態でもWeb UIは機能するようにしてほしいです、sipが有効ならその範囲で可能なものだけ、sipが無効なら全機能解放という感じです

> 1. 利用者は自分ですが、他の人も各々のマシンでホストして利用可能なように、ソースをgithubに公開したいと思っています

> 2. 2台とも同じApple Accountで、両方常時稼働はしているものの、デスクトップで間違いなく家で動き続けている保証がしやすいのはimacの方だと思うので、実運用はそっちでやりたいですが、検証時は違う環境として両方使う意義はあると思うので、両方で検証はしてほしいです

> 3. 全部盛りを最終目標としますが、初版でどこまで行くかなど、実装のフェーズ組みは実際に実装するあなたがやりやすい分け方をしてほしいです。

> tailscale経由でいいです

> この段階では、重大な未決事項を残したまま実装を始めないでください。

> 各変更に必要十分なテストを行い、各受け入れ条件と、それを確認したテストまたは手動検証の対応を残してください。

## Scope and constraints

One owner per Mac instance; other people self-host separately. Mac-local imsg RPC, no multi-Mac aggregation. Production target Intel iMac; SIP-enabled arm64 is a second required test environment. Node24.20.0, tested imsg0.14.2/0.15.1. Future full-feature product, but this slice implements authenticated reading only. No send/read-mark/typing mutations, uploads, attachment serving, search, watch/SSE, operation ledger, PWA, public exposure or service installer in this slice. Do not alter SIP/TCC, existing watchers, launch agents or Tailscale settings. No third-party runtime CDN, SSO, message archive, localStorage, service worker or private fixture exports.

Same-origin HTTPS browser → eventual Tailscale Serve → fixed127.0.0.1 HTTP Fastify → serial read source → local imsg RPC. HTTPS origin configured canonically, Host exact, supplied Origin exact; POST/DELETE require Origin and JSON. Forwarded identity/host not trusted; no CORS. Cross-site API fetch rejected. Static routes enumerate built index/assets, never arbitrary filesystem paths. Errors use closed codes and never upstream details. No HTTP request logging. Responses no-store, CSP self-only/frame-ancestors none/object none/base none, nosniff and no-referrer.

## Interfaces and data

- `setup`, `serve`, `auth status`, `auth revoke-all`, `auth rotate`; status/revoke/rotate aliases. Config via IMSG_WEB_STATE_DIR, IMSG_WEB_ORIGIN, IMSG_WEB_IMSG_PATH, IMSG_WEB_PORT. No key in arguments/config.
- GET `/health` → `{alive:true}` only.
- POST `/api/session` `{key}` → session Cookie + `{csrfToken,mode:'readonly'}`; GET same endpoint returns that session data; DELETE with Cookie/Origin/CSRF/JSON revokes it.
- GET `/api/capabilities` → `{epoch,mode,features:{state,reasonCode}}` without paths/account data.
- GET `/api/chats?limit=50` → `{epoch,limit,chats:[{id,name,service,isGroup,unreadCount,lastMessageAt,trimmed}]}`.
- GET `/api/chats/:opaque/messages?limit=50` → `{epoch,limit,messages:[{id,text,isFromMe,createdAt,trimmed}]}` oldest first. Unknown metadata null; no HTML/autolinks/images from text.
- Limit50–1000 in increments50. Source supports the underlying adapter's positive integer limit≤1000. Opaque HMAC IDs scoped to boot and DB epoch; no raw rowid/GUID in web responses.

Owner leaf directory0700/current uid/non-symlink, owner JSON0600/regular/current uid/no-follow, schemaVersion1/keyHash SHA256. Setup refuses existing leaf. Key is32 random bytes base64url43; hash only on disk, no plaintext key logs except explicitly requested setup/rotate stdout. Atomic exclusive temp write/fsync/rename/directory fsync for rotate. Same-uid administrator and trusted parent directory are assumed. Unix admin socket0600 and exclusive lock0600; stale socket/lock never automatically removed.

Auth memory-only max16 sessions: cookie hash, csrf, creation, last authenticated access. Seven-day absolute/24-hour idle timeout; polling counts as activity. Cookie __Host-imsg_session Secure/HttpOnly/Strict/Path=/ no Domain. Check on admission and before successful response. Login20/60s global; auth API120/60s per session. Logout/revoke/rotation/restart invalidate sessions. Data already delivered cannot be revoked. Rotate blocks auth and clears sessions before durable hash save, activates only after persistence; any partial failure stays blocked, admin socket can re-rotate even if ACK was lost. Only one rotation concurrently; admin max4 connections/body2KiB/5s. State hash loaded under instance lock. A rotation still writing prevents lock release, including during shutdown.

Read source: serial one active+32 waiting, only identical epoch/method/id/limit coalesce. RPC child has inherited bounded frames4MiB and read-only shutdown policy. Status before every read, DB path dev/ino/birthtime checked before/after; replacement/missing rejects409, retires epoch/map, closes old child before generating another. Initial child discovers path, then stat→close→new reader→status/stat. Same-inode in-place restore is not detectable; requires restart. Failed child shutdown blocks reconnect and propagates to source close. CLI status cache30s, failure degrades advanced capability only except unconfirmed CLI termination blocks recovery. Map2000; overflow rotates epoch, rebuilds current list. Name512/text16384 UTF16 units without dangling surrogate, trimmed marker; HTTP reply4MiB cap. HTTP active32/TCP64/body2KiB. No mutation child shares this lifecycle.

Shutdown: block auth, reject new HTTP, HTTP close deadline5s then force close and bounded completion check; source close deadline5s; admin close deadline5s includes in-flight rotation. Any uncertain shutdown fails and retains owned lock; never delete another instance's artifacts. Normal confirmed stop allows restart.

React responsive desktop2-pane/mobile360, light/dark, accessible keyboard controls. Loading/empty/stale-error/truncated states. Show read-only15s polling. Hide tab pauses polling; focus resumes, one cycle/timer with coalesced pending refresh. All private state/key cleared on logout/401; common generation guards every resource so late old requests cannot restore old data. Chat switch immediately clears body. Epoch change clears all resources and selection. No new login until outstanding logout settles; explicit failure if server revocation unconfirmed.

## Acceptance

| ID | Required proof |
|---|---|
| B01 | Auth, exact Host/Origin/CSRF, Secure browser cookie, no private data unauthenticated |
| B02 | Session bounds/expiry/logout/revoke/rotate/restart; delayed read returns401/no body after revocation; UI clears all private state |
| B03 | Private state validation, setup refusal, atomic rotation including partial failure/ACK loss, lock ownership and load-after-lock |
| B04 | Actual temporary file replacement plus fake old open handle; old IDs invalid, shared queue bounds/map2001/failed-close no reconnect |
| B05 | Synthetic HTTPS browser reading, long/empty/error/null, limit1000, delayed selection/epoch/logout, hidden polling, desktop/mobile/keyboard visual QA |
| B06 | Identical built archive on both Macs, foreground loopback authenticated read/revoke/confirmed close, no mutation; distinguish from production Tailscale/browser evidence |
| B07 | Typecheck/build, original43 regression tests, new boundedness/failure tests, private-data scan, independent review, locked dependencies |
| B08 | Confirmed normal stop/restart; duplicate-start does not remove owner socket; HTTP/reader/admin rotation uncertain stop retains lock and returns failure |

## Phases, alternatives, unresolved gates

Plan review → lead core → UI on fixed interfaces → independent acceptance assertions → integration and synthetic browser → two real environments → code review → evidence and local commit. No overlapping file ownership. Existing P0a client reused; SQLite ledger delayed to sending. Rejected alternatives: Tailscale-only identity (other tailnet members), Basic-only session model, external SSO/CDN, cross-origin frontend. SSE deferred to P1a. Live local admin retained instead of restart-only revocation; single serial source instead of multiple redundant caches/queues.

This is not full P0 or P1 completion. Tailscale Serve/LaunchAgent authority and final configuration, clean-install/restore operating procedure, p95/performance budgets, live watcher mutation coexistence, license/publication remain separate gates. User has not selected the policy for re-enabling new sends after an unconfirmed old operation; no send implementation until that consequential choice is resolved. A successful prior self-send or “continue” is not approval of an override policy.
