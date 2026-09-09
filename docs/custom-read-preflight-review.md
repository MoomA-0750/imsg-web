# Isolated custom imsg read preflight

## Relevant user requests (verbatim)

> 両方で検証はしてほしいです
> tailscale経由でいいです
> nodeにフルディスクアクセスを与えました
> 続けてください

## Requirements and constraints

Evaluate isolated contact-batching candidates based on imsg 0.14.2 (Intel, SIP disabled) and 0.15.1 (M1, SIP enabled). This phase establishes existing read access and process cleanup, not production performance acceptance. Both machines belong to the user. Existing approval covers isolated build/read investigation. Installed imsg, Messages data, TCC/SIP, launchd, and Serve configurations must not change. No sending, read-state mutations, permission requests, signing changes, or public publication.

## Proposed implementation

Lead owns the runner because child lifecycle, protocol parsing, and permission constraints are coupled. A standalone Node ESM runner starts one direct executable with `rpc`, shell disabled, stdin/stdout/stderr pipes. Live CLI requires macOS and an inherited SSH connection. The reviewed RPC startup selects skip-if-not-determined with non-TTY stdin; 0.15.1 retains its existing SSH source policy. No environment spoofing. Static signature inspection does not establish TCC identity or grant equivalence.

Before execution, record exact source commit, source file hashes compared with remote build inputs, Package.resolved digest, executable SHA256, architecture, and codesign facts. Runner accepts an absolute private staging binary path plus expected SHA256, validates realpath, file owner, regular/executable type, non-group/world-writable file and staging ancestors, then verifies its digest. Private root must be owned and mode 0700. Same-user concurrent artifact replacement is outside the threat model; freeze build activity during runs.

Send only `chats.list` with limit 1. Accept one matching JSON-RPC result containing a chats array. Do not print or save response content, chat identifiers, stderr, or exception messages. Output fixed result categories, elapsed milliseconds, row count, optional-name presence count, binary digest, and cleanup outcome. A missing optional name is inconclusive about Contacts permission. No history request or timing loop in this access preflight.

Bound stdout to 1 MiB and stderr to 64 KiB. Malformed, oversized, unexpected-ID, error responses or stderr cause failure with cleanup. Total request timeout 15 seconds. On success or failure close stdin, allow 500 ms exit, then TERM, then KILL after 500 ms. Wait for direct ChildProcess close; failure to observe close within a further 2 seconds is a cleanup failure. Signal only the child handle created by this runner, never process-name/PID scans or process groups. Handle SIGINT/SIGTERM and stdin errors. SSH disconnection is covered by SIGHUP where delivered; it cannot guarantee cleanup after host failure or parent SIGKILL. The RPC input EOF path must be audited for normal parent loss. No persistent service.

## Acceptance and verification

- P1: wrong digest/path/permissions rejected before spawn; synthetic temp-file tests.
- P2: only the fixed read RPC is sent; fake child asserts exact input and emits a valid result containing a secret marker; returned/output summaries must not contain the marker.
- P3: timeout, oversized output, invalid JSON, wrong ID, RPC error, stderr, and early exit all fail; synthetic subprocess tests assert direct child close.
- P4: a child ignoring EOF and TERM is killed and close observed; synthetic subprocess test.
- P5: each Mac reads at most one chat with existing access and exits; record fixed summary only. A prompt/access error stops further live attempts for that target pending user direction.
- P6: no performance or permission equivalence inference from passing P5. Matched release measurement and application C06 remain separate gates.

## Alternatives and unresolved items

Existing app profiling scripts assume stock wrappers and deployed application paths. A direct one-child preflight has no sampler or launchd dependency. A shell pipeline is smaller but lacks bounded framing and cleanup evidence. Reusing the application RPC client would couple candidate exploration to production version checks.

Pending review: adequacy of SSH-loss cleanup, payload validation, signature/input provenance, and test failure conditions. Claude direct review was previously unavailable; this file can be passed unchanged for a tool-free, nonpersistent Sonnet/Opus review. No Fable or automatic model routing.

## Review request

Find contradictions, failure conditions, omitted acceptance conditions, and reasons to reject this design. Review requirements/edges, simplicity, security/operations/performance, and testability. Report severity and a concrete counterexample. Do not edit files or access machines. Do not assume approval from the existence of this proposal.

## Revised implementation contract

The final verdict waits for close, code 0, no signal or escalation, exactly one complete newline-delimited JSON-RPC 2.0 response with the exact string ID and no trailing bytes. Envelope keys are limited to jsonrpc/id/result. Chat rows are objects with positive safe integer id and optional string contact_name; at most one row. All stderr fails immediately without retention. Late stderr, duplicate frames, incomplete frames and nonzero exit cannot follow a successful verdict. Cleanup timeout releases parent stream handles and unrefs the child while reporting closed:false; it does not claim termination. CLI summaries include the verified executable digest. The CLI entrypoint canonicalizes its path to handle macOS /tmp symlinks.

Additional required tests cover late failures, exact failure categories, cooperative-child EOF after parent death, pipe-retaining descendants with an external parent deadline, raw stdout/stderr confidentiality and symlink CLI invocation. Source audits of both exact versions' authorization and EOF paths are required before live access. No desktop prompt observer exists; source audit can establish unreachable explicit permission-request APIs, not an unconditional OS-level no-prompt guarantee during concurrent grant changes.
