# Isolated release comparison

## Independent review dispositions

Two independent agents reviewed the neutral release-comparison-review.md, then the implementation. Both reported no concrete runtime blocker under the trusted-user/no-concurrent-build execution contract. Reviewers had no Mac access. Lead implements the coupled protocol/comparison logic; no parallel code ownership.

| Finding | Disposition / reason |
|---|---|
| Artifact facts not tied to executed samples | Adopt: validate expected digest before every child spawn; prohibit concurrent builds/replacements during series. Record only digests that actually passed verification. Same-user malicious concurrent replacement is outside the experiment threat model. |
| Response speed alone may hide slower teardown | Adopt: aggregate and report both complete-response and startup-to-close times. No automatic overall-speedup verdict. |
| Pair/invalid-series behavior ambiguous | Adopt: pairs 1/2,3/4,5/6,7/8; failures stop the host, report incomplete; content/name mismatches excluded from aggregates. All sample timings remain visible. |
| JSON key ordering can cause false mismatch | Adopt: parsed recursive object-key sorting, array order preserved. Name absence is distinct from null/empty/value. |
| Binary digest versus private content digest terminology | Adopt: binary SHA256 is a verified artifact identifier; HMAC key and content fingerprints never leave memory. |
| Name-value tests also changed unrelated fields | Adopt: name-only change verifies equal non-name payload, unequal name fingerprint and exclusion from comparison. |
| 50-row boundary untested | Adopt: 50 accepted, 51 rejected, default1 rejects2. |
| Empty result and concurrency coverage | Adopt: matching empty results yield no-attributable-comparison; asynchronous active-count test requires concurrency1. Both elapsed and response aggregates exclude invalid samples. |
| Artifact replacement between samples lacks a dedicated integration test | Deferred: each execution calls the existing digest/ownership validator; its rejection tests already cover digest mismatch. This is limited assurance, not a claim of adversarial race prevention. |

One reviewer independently ran the then-current 26 tests successfully; lead subsequently added the specified focused cases. Direct Claude review remains unavailable from previous attempts; the neutral packet is the handoff artifact, with no Fable routing.

## Measurement scope

Native release baseline and candidate are built serially per host using the same Swift toolchain and identical Package.resolved, -j2, existing private scratch trees, force-resolved-versions/skip-update. No installed executable or signing settings change. A/B preflight limit1 precedes ABBAABBA limit50, every call in a fresh process. These are cold-process, OS-cache-warm exploratory samples, not warm RPC/history/API cycles or C06/p95 acceptance. Equal returned names do not prove equal effective permission sources.

## Results

M1 release builds succeeded (baseline231.11s/candidate238.48s); tracked input manifests matched and both locks retained SHA256 `be55852d84140bb12cbf4c58bb67f8260337878837e80d6ddeef41f259a3ae00`. Both release artifacts are native arm64, ad-hoc linker-signed, identifier imsg, no TeamIdentifier, Info.plist not bound in codesign output. This differs from prior debug signing metadata; no signature was changed or grant inferred. Both release limit1 preflights passed and returned one named row.

Artifacts A/B: `4e2f4083af27fef9171a70b77693d7e982a6c8eef624cfe79f3608847a0c40f6` / `71fc75a18269dd293cefc2094f2d445fb7d0a709d3d18681966c0219e9df0699`.

M1 ABBAABBA returned28 rows/15 named rows every time. All four pairs had matching ordered non-name payload and name presence/value. All ten children (including preflights) closed with exit0 and no TERM/KILL.

| Sample | Arm | Response ms | Total ms |
|---|---|---:|---:|
| 1 | A | 1469 | 1494 |
| 2 | B | 445 | 453 |
| 3 | B | 379 | 389 |
| 4 | A | 809 | 815 |
| 5 | A | 762 | 768 |
| 6 | B | 343 | 368 |
| 7 | B | 325 | 331 |
| 8 | A | 703 | 716 |

M1 medians: response A785.5/B361ms; total A791.5/B378.5ms. This supports improvement for this limited repeated cold-process experiment. The first A is slower and both arms trend down with warming; counterbalancing helps but four matched pairs do not establish a general performance estimate. No history, persistent RPC, Agent or Web UI acceptance claim follows.

Comparison tests: seven passed on each Mac. Existing supervisor checks and then-current comparator suite passed26 tests locally; independent reviewer separately confirmed26 at that revision. Final focused additions cover name-only mismatch, fixed limit boundaries, empty pairs and serial asynchronous execution. The full upstream experimental patches are preserved under experiments/contact-batch and pass git apply --check against pinned upstream checkouts. Generated patch context blank lines naturally trigger generic trailing-whitespace checks; non-patch code/docs pass diff --check.

Intel release builds succeeded (baseline298.63s/candidate294.33s). Tracked inputs matched; both locks retained SHA256 `119d9373e83738fb78819106065d119fcb53b262a77a97c1c087bf01aba273e9`. Both artifacts are native x86_64 and unsigned (unlike Intel debug and M1 release). No signature repair or grant was attempted. Both release limit1 preflights succeeded with one row and no optional name.

Intel artifacts A/B: `806375b93c30618cb68864aaa65791c5431ba981b0ab6345cb8bd1457b91a1bb` / `956e7bf2afe449ea9d6778f503e9768efacb58bf6e2e0873c44b36ff3a9f5498`.

| Intel sample | Arm | Response ms | Total ms |
|---|---|---:|---:|
| 1 | A | 1062 | 1073 |
| 2 | B | 277 | 292 |
| 3 | B | 269 | 278 |
| 4 | A | 1040 | 1046 |
| 5 | A | 1079 | 1092 |
| 6 | B | 269 | 277 |
| 7 | B | 258 | 263 |
| 8 | A | 973 | 978 |

Intel returned24 rows/0 named rows every time. All four pairs matched non-name payload and optional-name state; all ten children closed exit0 without TERM/KILL. Median response A1051/B269ms; total A1059.5/B277.5ms. This supports faster responses in the tested unsigned SSH context, but does not validate successful Contacts-name resolution on Intel. M1 is the evidence for preserving populated names. Cross-host absolute times cannot compare versions/architectures/SIP effects causally.

All20 live processes across both hosts exited cleanly; content, HMAC keys and fingerprints were not persisted. Runtime Node24.20.0, inherited actual SSH environment, stdin pipe, no build activity on the measured host. Measured scripts SHA256: preflight `38cfc40c40a623615b56b79b9bb0cf7203a90ae4d96dfda2c1f76c55fa7c16ff`, comparator `eb9cd5fa56394860fd1b24a0634fe33bf32df2cebfb78da9400ac768e5bf13cb`.

## Next acceptance work

The narrow comparison is complete. Next verify persistent RPC and messages.history with matching target/data/name conditions, then the original application/Agent C06 measurement definition. Application integration or dependency adoption is not authorized by this experimental result alone. The installed executable, production service state and original acceptance threshold remain unchanged. The current evidence is sufficient to continue the isolated performance investigation, not to deploy a fork or claim production readiness.
