# Read-only launch-context diagnostic review

## Relevant user requests (verbatim)

> 実際にimsgが入っているmacは2台あり、両方sshで接続可能です、macというエイリアスで、sip有効状態のm1 airに、imというエイリアスで、sip無効のIntel imacに繋がります、imsgはsip有効状態と無効状態で若干使える機能に違いがありますが、どちらの状態でもWeb UIは機能するようにしてほしいです、sipが有効ならその範囲で可能なものだけ、sipが無効なら全機能解放という感じです

> tailscale経由でいいです

> 各変更に必要十分なテストを行い、各受け入れ条件と、それを確認したテストまたは手動検証の対応を残してください。

The owner approved keeping deployment stopped while performing bounded read-only performance diagnosis and improvement. Existing deployment approval includes temporary per-user Agents on both Macs. No message mutations, TCC/SIP/power changes, production Serve/Funnel, existing watcher changes or publication.

## Requirements / constraints

Single-owner Node24.20.0 loopback authenticated runtime, unchanged a342425 application artifact; Intel imsg0.14.2 and ARM imsg0.15.1. Dedicated runtime already granted required permissions. Every read retains current RPC status and DB identity/epoch checks; no message cache or SQL index changes. Trust same-owner/admin code on each Mac. No machine-wide priority changes.

## Proposed bounded comparison

Use the same diagnostic script and source modules for a foreground run, one default ProcessType Agent run, and one ProcessType=Interactive Agent run, sequentially on each Mac. Agents have distinct temporary labels local.imsg-web.perf-standard / local.imsg-web.perf-interactive, no login-persistent plist, KeepAlive=false, Aqua, AbandonProcessGroup=false, ExitTimeOut45, Umask63. Absolute dedicated Node/script paths; private0700 temporary directory, precreated0600 output/error logs. Environment only explicit approved diagnostic marker, deployment base, artifact path and imsg path; no keys. Plists validated with plutil before bootstrap. No other service is stopped or modified.

Each run creates a new private owner state, generates key only in memory, listens only on a dynamically allocated loopback port, logs in itself, reads capabilities/chats50/history50 for cold1 + warm6 cycles nominal15-second start cadence. History uses each host's first chat, stable within the run, not a cross-run identity match. CLI-refresh timing is separate. Empty stores skip history. Outputs only fixed stage labels, elapsed values/counts/booleans and own random state name. No body/ID/cookie/key. Absolute HTTP deadline15s; bounded existing readonly RPC and runtime stop. Seven helper tests check stage allowlist/output exclusion/minmax/cleanup failure sequencing; not full integration coverage.

After run: structured revocation401/runtime close/state cleanup evidence is required; inspect launchctl exit code, no current PID, fixed error log empty, state owner.json only. Bootout exact finished label. Any missing evidence is failure, retain state, no automatic lock removal. Do not run both variants together. Stop after two Agent variants; no permanent configuration change.

## Acceptance / interpretation

- All run cycles succeed, include per-endpoint/internal timings and all raw six cycle totals. Label short-run statistics min/max, never acceptance p95.
- Compare per-stage directions across both variants; report dataset/environment/load/order confounders. Same-first-chat across runs is not proven, so do not treat history timings as a controlled same-chat comparison.
- Default Agent run is a contemporaneous control; Interactive run follows it, so warmed caches/order may confound. Counterbalanced order repeat is required for causal claims; the original-code20-sample gate is a separate readiness condition.
- Interactive changes resource scheduling only. It may consume resources more aggressively, affecting other applications or energy use. No global limits, niceness, SIP or TCC are changed.
- Result is evidence for a candidate deployment-only fix, not an automatically accepted new SLO or completed P0c gate. Production remains stopped until outstanding deployment safety checks are satisfied.

## Final diagnostic constraints

An in-script180s deadline aborts HTTP/sleeps and enters cleanup; current CLI work has an existing13s bound, RPC10s, HTTP15s, runtime shutdown bounded by its existing close contract. External supervisor inspects exact label and owned PID at240s; a stalled run is booted out and subsequent variants are aborted until owned-process absence is proven. No automatic lock removal. Never advance on absent cleanup evidence. The exact postcondition is a retained private state directory containing only owner.json, previous successful cookie rejected401, owned runtime exited and recorded listener closed. Private logs are preseeded with one newline; error log must remain exactly that seed.

Startup preflight checks gui/501 and absent target labels; capability observations are emitted per context, and access/epoch/read failures are classified separately from latency. A new runtime's first request is not an OS-cold-cache claim. Missed15s slots are skipped with no overlapping/catch-up cycles, actual start offsets are recorded. Parent CPU user/system times and end RSS are reported; child CPU, system pressure and energy impact are unassessed, so this experiment cannot justify permanent resource-policy adoption.

For causality, counterbalanced repeat is required (not replaceable by a larger one-way sample). A20-sample gate is a separate readiness condition. History and total latency are exploratory while cross-run chat identity is not pinned. This first comparison will not claim causal proof, a complete performance pass or permanent adoption.

## Alternatives / undecided

Keep default and accept latency (owner decision); reduce redundant app diagnostics only after profiling and safety review; change upstream imsg or DB queries (larger scope, not this experiment); Adaptive requires XPC transaction integration absent from the HTTP wrapper. Interactive adoption and long-run resource impact remain undecided pending results.

## Review request

Find contradictions, failure conditions, overengineering, security/resource risks and invalid acceptance claims; do not seek agreement. Report severity, affected condition, smallest correction. No edits, SSH or external changes. For Claude use Opus/Sonnet, one-shot nonpersistent/tool-free stdin packet only; Fable and routing that cannot exclude it are forbidden.
