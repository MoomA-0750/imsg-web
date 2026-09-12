# Step2 Phase B — pass 2 result and provenance classification (2026-09-12)

Read-only per-artifact pass on both hosts. **`imsg` was not invoked and no
dedicated Node was executed.** Nothing was created, moved, deleted or signalled.
Both logs carry the completeness marker. Raw output went to the private evidence
directory and was not read by the agent; only derived verdicts were surfaced.

## The headline

**The published Intel candidate digests do not come from the directory called
`candidate`.** They come from `candidate-r3`. The directory named `candidate`
holds a superseded earlier attempt whose release product does not exist and
whose debug product has no prior record.

This is the exact failure this phase was built to catch. Anyone reusing "the
candidate tree" by name — for a rebuild, a re-measurement, or a digest
allow-list — would have picked the tree whose binary was never validated, and
nothing about the name would have warned them. A tree is identified by the
digests of its products, never by its path.

## B2 closed: both Node runtimes are upstream-bound

The `bin/node` digests computed from the official Darwin archives match the two
Macs exactly:

| Host | On-disk `bin/node` | Official archive member | Verdict |
|---|---|---|---|
| Intel | `bb37f3a05d1104a9ca2488718a32ff07f3d0725b7b7b6a04bb26a5af7213fe12` | darwin-x64 | **matched** |
| M1 | `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a` | darwin-arm64 | **matched** |

Both carry Node's own Team Identifier in their signature. Each runtime moves
from *no prior record* to **U-bound**: identical to a specific official release
image. The ceiling is unchanged — this is upstream binary identity, not source
provenance, and the checksum list was fetched over HTTPS, not signature-verified.

## The Intel build trees are not git repositories

All three return exit 128 from `rev-parse`, and the resolved git directory is
empty. They are plain directories.

The tree-hash binding designed after the F2 review therefore **cannot be applied
to them**. That plan assumed the trees carried the patch as commits, because the
contact-batch README records candidate commit IDs; whatever checkout those
commits lived in is not what is on this machine. No git metadata survives here.

What remains available is file-content binding, and it is worth having:

- **`Package.swift` is byte-identical to upstream v0.14.2 in all three trees**
  (`507c9e98…`). The manifest is the reviewed one.
- `Package.resolved` is the re-resolved `119d9373…` in all three, consistently.

Neither binds a built product to source. Nothing available to us does; that is
Phase D's job, and Phase D builds in fresh directories.

## Products found, and which records they answer to

| Tree | `.build/release/imsg` | `.build/debug/imsg` |
|---|---|---|
| `baseline` | `806375b9…` = **published Intel release A** | `054e71d7…` — no prior record |
| `candidate` | **absent** | `7bdd4610…` — no prior record |
| `candidate-r3` | `956e7bf2…` = **published Intel release B** | `f1433d9e…` = **published Intel debug candidate** |

So `candidate-r3` is the artifact behind every published Intel result, and
`candidate` is a dead end that was left in place. The `r3` suffix implies
earlier attempts; only this one was ever measured.

## The re-resolved lock, finally read

Its content was extracted from the pass and re-hashed to `119d9373…`, matching
the published digest, so what follows is the real file. Against upstream
v0.14.2 it adds **two** transitive entries:

- `csqlite` 3.53.3, revision `8ad83035…` — the same version upstream itself
  pins from 0.15.x onward.
- **`sqlcipher.swift` 4.19.0**, revision `39f21245…`, from
  `https://github.com/sqlcipher/SQLCipher.swift`.

The first is reassuring: the isolated resolution chose what upstream later chose.
The second is the reason "reviewed the digest" was never good enough. A
SQLCipher package appearing in the dependency graph of a tool that opens the
Messages database is exactly the kind of thing a person should look at, and
until now nobody had — the records held a hash and no contents.

Two things keep this from being alarming, and one keeps it open:

- `Package.swift` links `CSQLite` only `.when(platforms: [.linux])`, so the
  SQLite C layer is not linked into a macOS build at all.
- Resolution is not linkage. SwiftPM resolves the whole graph regardless of
  platform conditions, so a pin can exist without a single byte reaching the
  binary.
- **But upstream's own complete lock at v0.15.4 does not contain
  `sqlcipher.swift`**, with the same `sqlite.swift` 0.16.0 pinned. Two
  resolutions of overlapping graphs disagreed about whether that package belongs
  in the lock. Why is **not established**, and this record does not guess.

**Established in Phase D.** Resolving v0.15.4 on the Intel host reproduced it
exactly: the same package at the same revision was added, and `originHash` was
recomputed as the manifest digest. The disagreement is between **SwiftPM
versions**, not between machines or between this project and upstream's intent.
The historical lock was normal for the toolchain that produced it. See
`docs/step2-phase-d-result.md`.

This matters less going forward than it would have: the go-forward pin is
v0.15.4 with its own complete, upstream-committed lock, so the historical lock
describes historical evidence only. It does mean Phase D must record the lock
digest **before and after** each build. If SwiftPM rewrites it, "pinned inputs"
was not a property of the build.

## Toolchains: a new recorded variable

| Host | Swift | Developer directory | Default target |
|---|---|---|---|
| Intel | 6.1.2 | Command Line Tools | `x86_64-apple-macosx15.0` |
| M1 | 6.4 | **Xcode 27.0.0 Beta 2** | `arm64-apple-macosx27.0.0` |

Both satisfy the `swift-tools-version: 6.0` and `macOS 14` requirements, so
v0.15.4 is buildable on both. But the two hosts now differ by compiler version
as well as architecture and OS, and one of them is a **beta** toolchain.

Consequences to carry forward: a cross-host comparison has a compiler variable
in it, and any artifact built on the M1 is built by a pre-release compiler.
Within-host baseline-versus-candidate comparisons are unaffected, which is
another reason the project has always confined its conclusions to those.

## Space, for the fresh build directories

| Host | Free | One full build tree |
|---|---|---|
| Intel | ≈160 GB | ≈1.2 GB |
| M1 | ≈23 GB | (not measured — no tree survives there) |

Two arms are roughly 2.4 GB per host. Both hosts have room. The retained app
releases are ≈21 MB each on both hosts.

## Classification

| Artifact | Class | May be used for |
|---|---|---|
| Node runtimes, both hosts | **U-bound** | Running the app, after Phase C |
| Stock imsg, both hosts | **U-unbound** | What the owner runs by hand. Not a measurement baseline, and no longer on the critical path now that production will run a build of ours |
| `a342425`, `9b64d36-p0c1` (both hosts) | **H** | Historical evidence. Never a measurement artifact |
| Intel `baseline` tree and its release product | **H** | Provenance of published release A |
| Intel `candidate-r3` tree and its products | **H** | Provenance of published release B and the debug candidate |
| Intel `candidate` tree | **X** | Nothing. Superseded, no published product, not to be reused or renamed |
| M1 published digests | **H, no surviving artifact** | Cannot even be re-matched |

Nothing was deleted, and the deletion-candidate list remains a proposal.

## Phase D rebuild list

Built fresh, in new directories, on each host:

1. `baseline` — upstream v0.15.4 (`e2f5046`), unpatched.
2. `candidate` — v0.15.4 plus the stored contact-batch patch.

Same version on both hosts for the first time, which is only possible because
production will run a build of ours. Inputs: the pinned commit, the stored patch
(`6715e27a…`, verified to apply cleanly to v0.15.4), and v0.15.4's committed
lock. Lock digest recorded before and after each build.

The existing trees are neither reused nor deleted.

## What Phase B did not establish

That any existing Mac artifact was built from reviewed source — no classification
above claims it. That `sqlcipher.swift`'s presence in the historical lock is
benign; only that it is not linked on macOS by the manifest's own condition.
That a beta compiler produces an artifact equivalent to a release one. That
v0.15.4 builds at all on either host — that is Phase D, and it may fail.

Nothing here authorizes executing `imsg`.
