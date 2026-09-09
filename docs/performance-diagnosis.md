# P0c performance diagnosis — partial, 2026-09-09

Deployment remains stopped. This is a bounded diagnostic, not a new SLO or a completed C06 gate. The owner approved diagnosis and speed improvement without publishing. No production application code, installed imsg, Messages data, TCC/SIP, global priority or Tailscale settings changed.

## Observations

Same a342425 source/runtime modules with timing wrappers around the existing RPC and CLI calls, actual loopback HTTP/authentication, isolated owner state per run. One first request in a fresh runtime plus six subsequent cycles, capabilities→chats50→first selected history50. No OS cache purge. Hosts had24 and28 chats, each selected history returned50 messages. Cross-run history identity was not pinned; totals/history comparisons are exploratory. The initial foreground run used the same work with an earlier diagnostic-label/deadline version of the recorder.

| Context | Intel subsequent cycle range | M1 subsequent cycle range |
|---|---:|---:|
| SSH foreground | 1.644–2.194 s | 0.763–1.827 s |
| Default Agent | 3.607–4.514 s | 2.878–4.162 s |
| Interactive Agent | 3.104–3.785 s | 2.737–3.410 s |

Ranges are six raw observations, not p95. Default precedes Interactive; this order does not establish causality. The Interactive experiment did not demonstrate that all cycles meet the preliminary3s guidance. No permanent ProcessType change was adopted.

| Mean of six cycles | Intel default / Interactive | M1 default / Interactive |
|---|---:|---:|
| Capabilities endpoint | 477 / 307 ms | 241 / 89 ms |
| Chats endpoint | 2,141 / 1,932 ms | 1,261 / 1,243 ms |
| History endpoint | 1,284 / 1,115 ms | 1,950 / 1,686 ms |

The measured RPC wait accounts for most of these endpoint times. For example, Intel's final default cycle spent1,918.4ms in chats.list and1,013.7ms in messages.history; M1's final Interactive cycle spent1,162.4ms and1,632.5ms. Periodic CLI diagnostics also contribute, but removing them alone does not address the dominant cost. No identity/permission check was removed and no message cache was introduced. Internal imsg CPU/I/O/Contacts attribution remains unproven; the script measures client-side request latency, not an internal profiler.

Default Agent classification has resource limits; Interactive changes this policy and can contend more with other apps. This is described by the [Apple launchd manual source](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5) and the installed Mac manual. This policy is a diagnostic variable, not proof of the observed root cause. Only parent CPU/end-RSS were recorded: no child CPU/energy assessment or continuous RSS claim. All capability observations retain the expected SIP differences.

[Raw Agent timing evidence](performance-diagnostic-results.json) contains all7 records per variant and the safe summary/cleanup fields, with no body/recipient/opaque chat ID/key/cookie/state path/PID. Foreground records were observed in tool output and are summarized above, not reconstructed as a full raw JSON artifact.

## Recorder and verification

`scripts/diagnose-performance.mjs` is a manual, Mac-only diagnostic pinned to the already-installed a342425 release and Node24.20.0. It requires IMSG_WEB_DIAGNOSTIC=readonly-approved, explicit IMSG_WEB_BASE, IMSG_WEB_RELEASE and IMSG_WEB_IMSG_PATH; optional argument foreground/agent-standard/agent-interactive labels the context. It does not install or start an Agent itself. Do not run it against an unverified artifact, concurrently on the same Mac, or treat it as a generic public health endpoint. The accepted local threat model trusts same-owner/admin code; archive rechecking does not detect arbitrary hostile-admin replacement of the installed tree.

Seven tests (`npm run test:diagnostic`) cover timing-event secrecy, outbound stage rejection, short-run min/max, successful cleanup and each failing cleanup phase. Typecheck and all118 existing tests passed after integration. These are not full startup/HTTP/scheduling/path-trust integration tests. Live runs provide separate actual HTTP/read/revoke401/normal-exit evidence. The first invocation via macOS/tmp did not call main because the module path resolved to/private/tmp; it produced no observations and was not counted. The direct-entry guard was corrected to compare real paths.

The recorder uses an180s in-process abort, fixed HTTP15s and existing CLI/RPC/close deadlines; missed15s start slots are skipped without overlap. Both Agent variants on each Mac exited0 in approximately93–95s. Previously successful cookies failed401 after revoke. Parents exited, recorded ports had no listener, and retained private state contained only owner.json. Each finished temporary label was booted out; both Serve JSON outputs remained empty. Private raw logs/archives/state are retained, not deleted. Error files contained only their initial newline.

## Review dispositions

| Finding | Decision and reason |
|---|---|
| Script path/executable trust insufficient | Adopt scoped validation: fixed artifact/arch-specific imsg paths, owner/mode/non-symlink checks, canonical Homebrew ancestry, previously verified artifact checksum rechecked. Hostile same-owner/admin protection is outside the approved trust model |
| Six-sample p95 misleading; periodic CLI mixes work | Adopt min/max with all raw cycles and split summaries by CLI-refresh presence |
| Cleanup could hide which phase failed | Adopt independent revoke/close/state checks, always emit a structured cleanup result; successful close, not only client.closed, is required |
| Empty chats and different first-chat workloads | Adopt empty-store handling and explicit unmatched-history limitation |
| Tests claimed more than helper assertions | Adopt narrower test titles and cleanup failure cases; full integration coverage remains pending |
| No complete deadline/failure supervisor | Adopt180s abort and240s external stop rule; no next variant after unconfirmed cleanup |
| Revocation and port closure ambiguous | Adopt same previously successful cookie401 and external recorded-port/parent checks |
| Resource tradeoff unmeasured | Partially adopt parent CPU/end-RSS and available load observations; child CPU/energy impact remains unassessed, so no permanent adoption |
| Startup/capability differences, cold naming, cadence and retained-state ambiguity | Adopt separate failure classification, per-context capability checks, first-in-fresh-runtime label, skip missed slots, exact owner.json-only retained-directory condition |
| More samples cannot remove ordering bias | Adopt counterbalanced repeat as a separate requirement for causal claims;20-sample gate is only readiness evidence |

Sol reviewed the recorder and re-reviewed scoped fixes with no remaining significant objection under the stated trust model. Two independent reviewers covered requirements/simplicity and operations/security/testability for the neutral [comparison packet](performance-review-packet.md); all findings were resolved or explicitly limited as above, not decided by vote. Claude direct access remains unavailable; the packet is also a one-shot Opus/Sonnet handoff. A later Sol request to inspect imsg internals hit its usage limit and produced no review result.

## Next bounded investigation

Locate the remaining imsg wait before choosing a production fix. Candidates from fixed-version source include repeated per-message metadata queries and per-lookup Contacts authorization checks. These are hypotheses, not measured root causes. A short, exact-owned-process stack sample can distinguish waiting in Contacts/TCC from SQLite/data decoding. Do not spoof SSH environment, weaken permission checks, modify the Messages DB, replace installed imsg, or apply an upstream fork without a separately reviewed implementation scope. P0c deployment, counterbalanced/20-sample/30-minute acceptance and lifecycle/network handoff gates remain incomplete.

### Stack-sampling draft review — not executed

An independent review of a separate draft found five unresolved conditions: missing child-absence evidence if initialization fails before PID discovery; no proven sample/request overlap; missing report target/structure/nonzero-sample validation; numeric PID reuse/check-to-attach race; and a hard lifecycle bound that relies on supervision not yet implemented in the reviewed materials. All five findings are accepted for correction, **not resolved**. The raw stack sampler has not been run on either Mac or integrated into this release. A one-test parser check does not validate those operational properties. See [checkpoint](../STATUS.md) for the next steps.
