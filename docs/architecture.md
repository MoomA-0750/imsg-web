# P0a contract foundation

> **Scope note (2026-09-12).** This file describes the P0a milestone and is kept
> as that record. Two of its statements are no longer true of the integrated
> product: P0b added a loopback HTTP listener and owner-key authentication, and
> P0c produced a LaunchAgent generator (no production agent is installed and
> production remains stopped). Database writes and Messages mutations are still
> absent. The checked imsg versions are now 0.14.2 (Intel) and **0.15.3** (M1);
> see `docs/imsg-0153-upgrade-assessment.md`. For current state read `STATUS.md`.

Scope: Node24 TypeScript, persistent local read-only `imsg rpc`, typed adapter, capability diagnostics, non-content doctor output, synthetic tests. Build output is portable JavaScript; the Node executable is architecture-specific. No runtime npm dependencies. No HTTP listener, database writes, Messages mutations, authentication claim, or deployed LaunchAgent.

## Interfaces

- `ReadonlyRpcClient`: `request`, `onNotice`, `close`, `counts`. The method allowlist is enforced at runtime, not just in TypeScript. Executable and fixed argv are trusted local configuration, never browser input. `shell:false`.
- `ReadonlyAdapter`: status, chats, history, one watch subscription and unsubscribe. Positive safe-integer IDs, bounded limits, response validation, field whitelist. These are internal local IDs, not future Web API IDs.
- `capabilities`: normalized state/reason for chats/history/watch/contacts/read/typing/send. Read/typing are advertisements for diagnostics, never callable here. Send is always unknown/NOT_IMPLEMENTED.
- `doctor`: CLI entry via absolute `IMSG_PATH`. Structured summary only. RPC error text/data, stdout details, and stderr diagnostics are never printed.

## Bounds and failure semantics

4 active requests including control, 32 queued. Request37 fails immediately with QUEUE_OVERFLOW. 10-second deadline from admission. 64KiB request / 4MiB stdout-frame bounds; stderr drained without buffering. Unknown notifications do not become responses; IDs are exact strings; duplicate/unknown response IDs do not resolve other work.

Timeout or abort after dispatch closes the entire read-only child, fails all work, and prevents further dispatch. A queued abort only removes that queued request. Malformed frames and EOF fail pending work. No automatic reconnect or retry. Uncertain subscription creation closes the child before another instance may be created.

Close rejects new work synchronously, sends EOF, then SIGTERM after 2 seconds and SIGKILL after another 2 seconds. Failure to observe close within a final second reports SHUTDOWN_FAILED. Only the directly spawned child is signalled. There is no process-group kill or claim to clean up grandchildren. **This lifecycle must not be reused for a mutation-capable child.** A future shared read/mutation client needs a separately reviewed lifecycle.

## Capability truth table

| Input | Output |
|---|---|
| Malformed/missing RPC snapshot | unknown / RPC_STATUS_INVALID |
| Unverified version/protocol | unknown / VERSION_UNTESTED |
| Known version, DB unavailable | reads unavailable / DATABASE_UNAVAILABLE |
| DB ready + required method | reads available / SUPPORTED, regardless of bridge/contacts |
| Required method missing | unavailable / METHOD_UNAVAILABLE |
| Contacts denied | contacts unavailable / CONTACTS_UNAVAILABLE |
| CLI snapshot missing/mismatched | read/typing unknown / CLI_STATUS_INVALID; DB reads unchanged |
| SIP enabled | read/typing unavailable / SIP_ENABLED |
| SIP disabled + individual flag + method | diagnostic available / SUPPORTED |
| Individual flag false | unavailable / FEATURE_UNAVAILABLE |

Unknown CLI SIP/flag combinations remain unknown. A single bridge selector or a compiled method list is never sufficient. Initial checked versions: imsg0.14.2 and0.15.1. The M1 host's stock imsg is now 0.15.3; every audited call-path file is byte-identical to 0.15.1.

## Decisions and alternatives

The full application plan is a single Mac-local Node server serving a static React UI over Tailscale HTTPS, with an owner key/session boundary and SSE invalidations. The current milestone stops before that boundary. Python/FastAPI and Swift were alternatives; a Linux+SSH application would add a transport and file-transfer boundary. A local persistent subprocess keeps the P0a contract small.

No reconnect queue, message mirror, or mutation implementation is needed to validate read contracts. A shared mutation client and an isolated read client are future alternatives: the former needs non-killing recovery semantics; the latter adds a process. Do not silently extend this read-only client to send.

## Primary sources

- [imsg v0.15.1 RPC](https://github.com/openclaw/imsg/blob/v0.15.1/docs/rpc.md)
- [imsg v0.15.1 JSON](https://github.com/openclaw/imsg/blob/v0.15.1/docs/json.md)
- [Node24.20.0 release checksums](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt)

Source contracts are not substitutes for actual app acceptance tests.
