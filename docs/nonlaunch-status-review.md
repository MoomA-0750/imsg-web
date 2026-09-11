# Non-launching Web capability probes — review packet

## Relevant user requests (verbatim)

> imsgはsip有効状態と無効状態で若干使える機能に違いがありますが、どちらの状態でもWeb UIは機能するようにしてほしいです、sipが有効ならその範囲で可能なものだけ、sipが無効なら全機能解放という感じです
> tailscale経由でいいです
> 続けてください

## Requirements and constraints

P0 currently exposes authenticated readonly chats/history. Sending and advanced mutations are not implemented. Both Macs must remain usable for DB reads without a bridge. Background capability polling must not launch, kill, reinject, or repair Messages.app; SIP/TCC and installed imsg stay unchanged. Capability states distinguish available/unavailable/unknown and fail closed. Ultimate advanced functionality remains in scope for later phases, not this safety change.

Production deployment remains stopped. No remote experiment, Agent installation, Serve change, dependency replacement, or publication is part of this change. Existing C06 measurements and acceptance remain historical; changing the probe workload requires a new labeled application artifact and measurements, not retroactive comparison as an identical workload.

## Observed source paths

LiveSource.capabilities currently invokes CLI status every30s in addition to RPC status. Both pinned imsg0.14.2 and0.15.1 CLI StatusCommand implementations call IMsgBridgeClient.invoke(.status) when availability reports true. invoke can call MessagesLauncher.ensureLaunched (or ensureRunning with legacy IPC). If its readiness check fails, the launch operation kills Messages.app, cleans IPC and launches with injection. Availability and subsequent readiness are distinct checks; this is a possible race/legacy branch, not a claim it occurred during previous tests.

Both pinned RPCServer defaults use invokeWithoutLaunching. RPC status may exchange status IPC with an already-running bridge; it is not a promise of zero filesystem IPC writes. Messages DB queries remain readonly. Verify the full default path, including database/Contacts status and initializer, before remote execution.

## Proposed implementation

Remove automatic CLI status collection from the Web LiveSource, including its cache and injectable getCli dependency. Use the existing non-launching RPC status for basic read capability discovery. Preserve the standalone capabilities(rpc, cli) evaluator for explicit, supplied status fixtures/future separately audited callers, but let absent supplemental CLI evidence produce unknown advanced read/typing with a specific STATUS_PROBE_DISABLED reason. Invalid provided evidence remains CLI_STATUS_INVALID; invalid RPC/version still takes precedence. Do not infer SIP state or advanced readiness from method advertisement alone.

Keep CLI utility code only if still required by explicit diagnostic scripts; clearly label its launch risk and prohibit it in the new custom API experiment. No configurable opt-in or hidden fallback in LiveSource. The UI continues showing advanced features as unknown, not usable. Check reason rendering and shared contract tests. No new storage or data model besides the reason-code union; no migration. Existing basic functionality, auth, opaque IDs, epoch checks and shutdown rules remain unchanged.

Lead owns LiveSource/capabilities/contracts changes and integration (cross-cutting safety boundary and uncertain upstream behavior). Tests must assert forbidden invocation, not merely the returned capability state. Old diagnostic scripts that explicitly inject getCli are historical and must not silently run against a new incompatible artifact; document pinned a342425 as unsafe for this experiment. Preparing a new API experiment follows this change, not bundled here.

## Acceptance conditions

- S1: Default Web capabilities/chats/history, including repeated calls after30s and concurrent requests, never spawn status --json or enter any fallback CLI collector.
- S2: Valid RPC and no supplemental evidence: basic reads remain available as advertised; advanced read/typing are unknown with STATUS_PROBE_DISABLED. Invalid RPC/version errors retain precedence; malformed supplied CLI stays CLI_STATUS_INVALID. No advanced execution route is added.
- S3: Source failures, DB epoch replacement, shutdown and auth behavior continue to pass existing tests. The removed CLI shutdown test is replaced by relevant RPC failure coverage, not silently deleted to gain a green suite.
- S4: Human-facing reason text explains that a safe advanced-feature check is not yet implemented, rather than falsely reporting SIP enabled, missing user permission, or bridge absence.
- S5: Typecheck, unit/integration tests, build and relevant browser tests pass. Test assertions and failure conditions are lead-reviewed. No live C06/production acceptance claim.

## Alternatives

1. Patch both experimental imsg CLI status commands to invokeWithoutLaunching and rebuild. Retains the CLI data shape but adds a second upstream patch and leaves installed stock imsg users exposed unless a fork becomes required.
2. Add an independent bounded SIP probe and derive advanced availability from RPC+SIP. Requires a new child lifecycle, OS contract and readiness semantics; could support later advanced features without the CLI.
3. Derive advanced availability solely from RPC methods. Smaller, but drops the current explicit SIP guard and requires validating supported-vs-usable semantics across versions.
4. Keep existing CLI and precheck bridge readiness/environment. Separate checks cannot rule out a readiness race and must not be treated as a no-launch guarantee.
5. Disable automatic CLI now, with honest unknown advanced states. This is the proposed P0 scope; accurate safe SIP/advanced discovery remains future work before exposing advanced actions.

## Review instructions and open points

Read only. Search for contradictions, missing requirements, failure conditions, reasons to reject, simpler alternatives, security/operations and testability. Do not edit files or access Macs. Determine whether unknown advanced status is compatible with readonly P0 and whether any caller/test contract was overlooked. No implementation has begun.

This file is also a standalone Claude Opus/Sonnet review request: use one tool-free nonpersistent session with only this packet on stdin; no Fable or automatic routing. Direct Claude is unavailable in the recorded environment; do not infer a review occurred.
