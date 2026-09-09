# Release comparison proposal

## User requests (verbatim)

> 両方で検証はしてほしいです
> 続けてください

## Requirements and constraints

Compare isolated unmodified and contact-batched imsg on Intel/SIP disabled (0.14.2) and M1/SIP enabled (0.15.1). Existing grants only; no stock installation, signature edits, TCC/SIP/database mutations, Messages restart, send, persistent Agent or Serve configuration. The goal is controlled experimental evidence, not C06 acceptance or production adoption.

## Build plan

Build each existing pinned baseline and candidate using the same host Swift toolchain, release configuration, native architecture, -j2, existing scratch trees and byte-identical Package.resolved. Force resolved versions and skip dependency updates. Confirm tracked inputs against manifests, dependency lock equality, binary SHA256 and ad-hoc signature facts. Build serially per host; hosts can build in parallel. Keep private artifacts; no install or signing command.

## Proposed first measurement stage

Extend the existing independently reviewed one-child preflight narrowly to a fixed chats.list(limit=50) mode. Retain default limit=1 behavior and all framing/lifecycle/confidentiality checks. Fixed CLI mode only; no arbitrary RPC or parameters. Record elapsed startup-to-close and first matching complete-response elapsed separately, counts and verified digest. Each run starts a fresh process. Therefore this measures cold-process chats50, not warm RPC/history50 or Web UI cycles.

Run baseline/candidate in ABBAABBA order, sequentially, one process at a time per host. No simultaneous builds or experiments during measurement. Each child has the existing 15s request timeout and cleanup deadlines. Stop that host on failed access/protocol/cleanup; do not retry failed samples. Report all samples, medians/range; eight samples are exploratory and cannot establish p95. A and B use the same Node24 runtime, inherited actual SSH environment, pipe stdin, UID, source snapshot window and read limit.

Before an inference, require identical selected chat IDs/order and non-name payload and equal optional contact_name presence/value for each adjacent A/B pair. Compare in memory using a fresh random HMAC key shared for that host's run; output only match booleans and aggregate counts, never key/digest/chat content/IDs/names. A changed dataset or unequal names invalidates the pair for attribution; keep timing as descriptive only. No claim that equal names proves equal permission source. Baseline/candidate preflight on each release binary must pass using current grants before repeated reads.

## Acceptance and tests

- R1: fixed limit1 remains unchanged; limit50 cannot exceed50 rows. Exact request/fixed-mode/oversize/lifecycle regression tests.
- R2: result timing captured at complete frame, final success only on clean close; test delay-to-close separately.
- R3: equal data yields match; different order/ID/non-name fields/name presence/name values invalidates pair; synthetic tests assert no secret/key/content fingerprints in final summaries.
- R4: strict ABBAABBA sequencing and stop-on-failure; synthetic orchestrator tests with no live messages.
- R5: identical per-host locks/inputs/build settings and final artifact checks documented; per-host optional-name divergence is not attributed to batching.
- R6: report cold-process scope; warm history/API/Agent C06 remain required before adoption.

## Alternatives and unresolved items

This first stage omits persistent RPC, history selection, attachment handling and app integration. A larger combined benchmark could test those immediately but requires separate history targeting and warm-cache correctness checks. Reusing original app profiling would assume stock wrappers and deployment paths. Decide further stages from this small controlled result.

Independent reviewers should seek rejection reasons in requirements/edges, simplicity, security/operations, and acceptance/testability. No reviewer should edit files or access Macs. Claude can review this text with no tools and no persistent session using Sonnet/Opus; no Fable. No lead recommendation or prior reviewer conclusion is included.

## Clarified contract

Every invocation verifies its expected executable digest immediately before spawn. No concurrent source/build/artifact replacement is permitted. Only verified binary SHA256 values are reported; the prohibition on digest output concerns content HMAC fingerprints, not executable identity. Object keys are sorted recursively before fingerprinting, arrays preserve order, optional name absence differs from null/empty/value. Four pairs are (1,2), (3,4), (5,6), (7,8). Failed series are incomplete; mismatching or empty pairs contribute no comparison aggregate. Both response and total-lifetime aggregates are reported without an automatic speedup claim.
