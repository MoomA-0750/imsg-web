# Step2 Phase D — Intel build result (2026-09-12)

First write this project has made to either Mac. Both arms built. `imsg` was not
executed, and neither product was run.

| | |
|---|---|
| Archive digest, verified on the Mac | `cb5a2432…` — matched |
| Toolchain | Swift 6.1.2, Command Line Tools, target `x86_64-apple-macosx15.0` |
| SDK | 15.5, build `24F74` |
| baseline product | `f825229b81d88fcebaa511439818735b40cedfa45177da127a59959e02ebc8e1`, 5,539,712 bytes, x86_64 |
| candidate product | `52a2359648a47e45db6c5c64c21a24b212718a3a4a01c2bdbbd57a9805f61bd6`, 5,560,960 bytes, x86_64 |
| SUMMARY | `baseline: ok`, `candidate: ok` |

Both product digests are **no prior record**, which is the expected outcome: no
such artifact has existed before, and class R is defined by process rather than
by matching a digest.

## What went right, and was worth checking

**`patch-deps.sh` did exactly what reading it predicted.** PhoneNumberKit's
`Bundle+Resources.swift` moved from `9dafd788…` to `18cbfe5e…`; SQLite.swift's
`Package.swift` stayed at `877bc3bd…` — the no-op predicted from the pinned
source, since 0.16.0 already declares `PrivacyInfo.xcprivacy`. `git status`
showed exactly one modified file per arm. The unchanged digest also equals the
one recorded on the workstation from an independent clone, so that dependency is
pinned by content across two machines.

**The resource bundles exist beside the executable.** Both arms produced
`PhoneNumberKit_PhoneNumberKit.bundle` containing `PhoneNumberMetadata.json`
(`a9fcfe9e…`, identical across arms) and `SQLite.swift_SQLite.bundle`. This is
the failure that would otherwise have appeared later as a `fatalError` on the
contact path rather than as a missing file.

**The lock did not move during the build** — only during resolve, which is why
the digest is taken at three points rather than two.

## Finding 1 — the Phase B mystery is solved, and it was never about machines

Phase B found the historical Intel lock contained `sqlcipher.swift`, which
upstream's own complete v0.15.4 lock does not, and recorded "why is not
established". It is now established.

Resolving v0.15.4 on this host rewrote the lock from `61a6573a…` to
`ec9ddeba…`, identically on both arms, and the difference is two things:

1. `originHash` changed from `1668c8b5…` to `0785085f…` — and `0785085f…` is
   **exactly the SHA256 of v0.15.4's `Package.swift`**. So Swift 6.1.2 computes
   `originHash` as the manifest digest, which is the relationship Phase B saw at
   0.14.2 and 0.15.3 and wrongly called a rule. Upstream's committed v0.15.4
   lock was produced by a newer SwiftPM using a different algorithm.
2. **`sqlcipher.swift` 4.19.0 at revision `39f21245…` was added** — the same
   package and the same revision as in the historical 0.14.2 lock.

So the disagreement was never between machines or between our build and
upstream's intent. It is between **SwiftPM versions**: this toolchain resolves
SQLCipher into the graph, a newer one does not. The historical lock was normal
for the toolchain that produced it.

## Finding 2 — the pin gate passed while the graph gained a dependency

The gate checks that the four pinned revisions are still **present** after
resolve. All four were, so both arms continued. It does not check for
**added** pins, and one was added.

SQLCipher was fetched and extracted — it is a `binaryTarget`, so SwiftPM
downloaded a prebuilt `SQLCipher.xcframework` rather than source. It was **not
linked into the product**: `nm -U` finds zero SQLCipher symbols in either
binary. So the artifacts are unaffected, but a binary artifact that upstream's
committed lock does not list was downloaded onto the host, and the gate designed
to notice graph changes did not notice.

The gate should compare the pin set as a set, in both directions. Checking only
for absence is the same shape of error as a check that cannot fail.

## Finding 3 — the confinement contract was violated, and the sweep caught it

The contract said "every write names a path under the build root. Nothing
outside it is created, moved or modified." That was false.

`--cache-path`, `--config-path`, `--security-path` and `--scratch-path` all
pointed inside the root, and the caches and configuration did stay there. But
SwiftPM created **`~/.swiftpm/security`**, a compatibility symlink to
`~/Library/org.swift.swiftpm/security`, timestamped during this build. The
sibling `cache` and `configuration` symlinks in that directory predate this work
by days.

So one symlink was created outside the build root on the owner's machine. It
holds no data and points at a directory the sweep found otherwise untouched, but
the guarantee as written did not hold, and restating it as "only the four path
flags' targets are inside the root; SwiftPM still creates its own compatibility
symlinks in the home directory" is the accurate version.

Nothing was removed in response. This is exactly what the sweep existed to
detect, and the value of making confinement an observation rather than an
assertion is that the assertion turned out to be wrong.

## Still not established

That either product behaves correctly, or the same as the other, or the same as
the stock binary. That a product may be executed — it may not. Whether the M1
host, on Swift 6.4 with an Xcode 27 beta, resolves the same graph; its different
toolchain is now a reason to expect it may not.
