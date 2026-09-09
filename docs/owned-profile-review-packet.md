# Review packet: imsg read-performance investigation and possible next scope

Use this packet without conversation history or advocacy. Find contradictions, rejection reasons, failure conditions and smaller alternatives. Review separately: requirements/edge cases; simplicity; maintenance/security/performance/operations; testability/acceptance. No edits or external actions.

For a direct Claude design review: top-level Opus or Sonnet, one-shot, nonpersistent, no tools, this packet body only on stdin. No Fable or routing that might select it. Direct review is currently unavailable; this file is a handoff, not a review result.

## Relevant user requests (verbatim; no secret values)

> imsgというiMessageをcliで送受信できるバイナリがありますが、それをWeb UIでラップして、そのWeb UIからiMessageが利用できるようにしたいと思っています、まずimsgがどのようにどのようなことができるかを確認し、それを元に実際の実装方針をどこまでの機能をつけるかを検討してください

> imsgはsip有効状態と無効状態で若干使える機能に違いがありますが、どちらの状態でもWeb UIは機能するようにしてほしいです、sipが有効ならその範囲で可能なものだけ、sipが無効なら全機能解放という感じです

> 利用者は自分ですが、他の人も各々のマシンでホストして利用可能なように、ソースをgithubに公開したいと思っています

> 全部盛りを最終目標としますが、初版でどこまで行くかなど、実装のフェーズ組みは実際に実装するあなたがやりやすい分け方をしてほしいです。

> tailscale経由でいいです

> nodeにフルディスクアクセスを与えました

> 続けてください

## Requirements and constraints

Single-owner self-hosted Web UI; production Intel/SIP-custom, validation also M1/SIP-enabled. Preserve capability-based availability. Existing readonly core/UI and dedicated Node24.20.0 work on both. Installed imsg is0.14.2/0.15.1 respectively; deployed app artifact a342425. Tailscale-only eventual deployment, currently stopped. No automatic TCC/SIP edits, new Contacts grants, send/read-state mutations, Messages SQL writes, SSH environment spoofing, public publication, installed imsg replacement or reboots in this investigation. Keep UI independent from domain/API contracts. The tentative3s cycle guidance is not a user-approved SLO.

## Observed evidence

Prior30-minute runs completed but warm20 cycle p95 was3.834s Intel/5.282s M1; incomplete controls/raw series mean C06 is not accepted. Subsequent six-cycle exploratory default-Agent ranges were3.607–4.514s/2.878–4.162s; Interactive alone did not establish sufficient improvement and was not adopted. Most measured delay was inside imsg RPC response waits.

One1-second sample per idle/chats/history stage on each new owned imsg child found Contacts authorization frames in both active stages, none idle. Active RPC handler overlap/target/report structure verified. Category counts are overlapping inclusive stack counts, not CPU shares/call counts. Sampling perturbs timing; no exclusive causal claim. All recorded owned parents/children/samplers stopped and exact temporary labels booted out. Raw reports remain private on each Mac, no raw content is in this packet.

Pinned source: ContactCatalog.snapshot checks source.authorization per displayName call; displayNames batches handles using one snapshot. RPC handlers build per-chat/per-message/reaction contact names; message payloads also repeatedly query chat metadata. v0.15.1 SSH-only AddressBook fallback differs from default Agent context. Permission/source-change invalidation exists and must be preserved.

## Architecture and interfaces

Existing browser → authenticated loopback HTTP runtime → readonly source → imsg JSON-RPC → readonly Messages/Contacts access. This phase leaves browser, HTTP API, DTOs, DB schema and domain behavior unchanged. Existing diagnostic scripts observe this flow; no persistent message/contact cache is added. Capability status and fail-closed DB identity checks remain unchanged.

## Alternatives (not selected)

1. Stock-imsg wrapper-only scheduling/rendering: retain binary compatibility; may reduce duplicated work or perceived blocking, but does not remove per-RPC internal authorization cost. A slower polling interval or fewer requested messages changes workload/freshness and must not masquerade as passing the original performance gate.
2. Separately built experimental imsg, request-scoped batched name resolution using existing batch interfaces: could reduce repeated authorization work while avoiding process-wide permission caches. Requires upstream-source maintenance, architecture/toolchain verification and explicit permission-revocation semantics. Keep stock binaries installed and default. Neither build nor execution is approved yet.
3. Long-lived authorization/name-response cache: lower call frequency but stale permission/name/source risks; no approval to weaken revocation/freshness.
4. Interactive Agent classification: measured partial effect, greater resource contention possible, insufficient evidence for adoption.
5. Additional Contacts grant: owner privacy choice and no guaranteed removal of repeated-check cost; not a prerequisite for message viewing and not approved as a fix.

## Conditional phases for alternative2

1. Owner decides whether isolated upstream experimentation is in scope. Preserve the Web UI's stock-imsg support and forbid automatic replacement/publication.
2. Review a concrete patch design before code: request-scoped handles collection, batch resolution, pre/post authorization and data-source checks, invalidation behavior, absent names/denied access, partial errors/concurrency, and identical payload semantics. No generic mutable resolver shared between requests.
3. Lead implements isolated core after design resolves security questions; independent reviewer verifies acceptance assertions. Existing repository and Homebrew installations remain untouched. Build provenance/license/dependencies/toolchain and reproducibility must be recorded. Record signing/bundle identity and verify required access/capabilities using existing grants on both Macs; unexpected prompts or changed access fail this prerequisite, without granting permissions or bypassing TCC.
4. Synthetic tests first, then separately authorized side-by-side readonly Mac execution with normal cleanup. Compare same fixture outputs, revoked permissions simulated without changing real TCC, empty/mixed chats/reactions, source change during resolution, duplicate handles and per-request authorization counts.
5. Compare unmodified and patched pinned source built with identical toolchain, dependencies, signing and build settings on each host. Stock-binary compatibility is a separate check, not the sole speed baseline. Use counterbalanced same-workload performance comparison without stack sampling; then original20-cycle/30-minute gate if a candidate is selected. No production adoption solely from short profile evidence.

## Acceptance and unresolved items

Required: no new privileges/data writes, stock binary preserved, same API/capability behavior, request concurrency cannot leak names/state, repeatable failure/cleanup, unchanged polling/page-size acceptance definition. Permission-denial/source-change observation boundary and in-flight response treatment must be defined before patch approval; pre/post checks cannot guarantee detecting changes after the final check. Compare absent/blank/duplicate handles, all-self messages, reactions, empty history and group metadata. Output comparisons must use synthetic fixtures or private in-memory comparison, not publish real messages/names.

Unresolved: whether custom-build scope is acceptable; exact revocation boundary during a request; macOS toolchain availability and both architecture builds; whether batching materially improves total latency; maintenance versus waiting for upstream; full independently reviewed patch design. This is not a finalized implementation plan. Major security disagreements require owner decision rather than lead-only arbitration.
