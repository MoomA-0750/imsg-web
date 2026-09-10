# Web capability polling correction — 2026-09-10

Web LiveSource no longer imports or invokes CLI status, caches its result, or accepts a getCli override. Basic chats/history retain RPC status and database identity checks. Without supplemental evidence, advanced read/typing are unknown with STATUS_PROBE_DISABLED; invalid RPC/version takes precedence and malformed supplied evidence remains CLI_STATUS_INVALID. The UI explains that safe advanced discovery is not implemented. Sending and advanced actions remain unimplemented.

The existing untracked nonlaunch-status-review.md packet identified a possible upstream CLI launch/repair path. It was inspected but preserved outside this change. This implementation received lead source/test review only; no independent or Claude approval is claimed. Removal of the CLI path does not by itself certify every upstream RPC initializer or handler as side-effect-free.

Verification:

- Typecheck and production build passed on available system Node 22.23.1.
- All 123 unit/integration tests passed on available Node 24.19.0 with `npm test -- --maxWorkers=1`, outside the socket-restricting sandbox. Node 22 produced failures in short-timeout existing RPC fixtures, including missing request markers; no production timeouts or fixture deadlines were changed to pass them.
- All 10 Chromium browser tests passed, including the new explanatory status, mobile layout, authentication, polling, and stale response protection.
- New source regression covers concurrent calls and time beyond the former 30-second cache interval with forbidden CLI/spawn spies. Existing full-stack subprocess tests now require only RPC argv under both synthetic SIP configurations. Failed RPC bootstrap close must still block further reads and clean-shutdown claims.
- `git diff --check` passed. Pinned deployment Node 24.20.0 was unavailable locally; this is not verification on that exact runtime.

## Next experiment boundary

Prepare a separately reviewed isolated application/API measurement using this new application artifact for both stock and contact-batch candidates. Recheck pinned upstream RPC default initialization/status paths before live use. Custom executable admission still needs digest/source and exact child ownership validation; production executable restrictions are not relaxed here.

Historical `scripts/diagnose-performance.mjs` explicitly imports release a342425 and injects getCli. That artifact can execute the CLI status path and is unsuitable for the no-launch experiment. Do not repoint that script to the new app or silently drop its instrumentation. Use a new, labeled harness and application artifact; prior C06 timings are historical and must not be relabeled as matched workload results.

`doctor` still explicitly uses CLI status and can launch/repair Messages.app upstream. It is not a no-launch preflight. No Mac access, Messages action, Agent/Serve change, fork adoption, production restart, or push occurred in this work.
