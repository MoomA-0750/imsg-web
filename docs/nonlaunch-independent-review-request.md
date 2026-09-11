# Independent nonlaunch pipeline review request — 2026-09-11

Review the supplied implementation and tests as an independent critical reviewer.
Return Japanese findings ordered by severity, with file/function references,
concrete failure scenario and suggested minimal correction. Do not edit files,
execute code, access external services or use Fable. Distinguish a verified defect
from a missing live-use prerequisite; do not call synthetic tests live approval.

## Requirements

- Isolated read-only imsg API measurement preparation; no sends, read receipts,
  permission changes, stock binary replacement or production startup.
- Only exact-owned children may be terminated. An exited worker/reader and open
  inherited pipes are different states; uncertain cleanup must not pass.
- Login/session data, raw chat IDs, message contents, names and arbitrary errors
  must not reach public output. A private bounded registry may carry PIDs/port.
- Startup/operation failure and interruption must initiate cleanup; all deadlines
  and partial registration must fail closed. Timeouts must never upgrade to a
  successful measurement after late completion.
- Bundle integrity must cover the complete declared tree. A generated manifest
  digest is not independent provenance/admission; mutable-path races, Node launch
  environment and upstream no-launch behavior must be acknowledged separately.
- Current new work adds v2 worker results carrying fixed numeric timings/counts.
  Retain values only on successful workload, clean child exit and complete external
  registered-resource absence observation. Legacy boolean-only reports may remain
  lifecycle-only, never fabricated numeric samples. Reject extra/string fields,
  nonfinite/out-of-range/inconsistent samples. gateMeasurement remains false.
- Cross-arm raw-target/payload/name parity,20-sample/30-minute C06 scheduling,
  independently pinned Mac/runtime/imsg admission are not yet implemented.

Focus also on excessive complexity: identify concrete layers that can be safely
removed or combined, but do not replace ownership checks with optimistic success.
Treat the uncommitted sample transport as work in progress, not tested release.

Review scope: the explicitly supplied nonlaunch scripts, relevant tests,
ReadonlyRpcClient, LiveSource and HTTP/Auth contracts. No private data or unrelated
Vault content is included. This request does not authorize live execution.
