# Step2 Phase B — source-to-artifact provenance plan

Status: **proposed, not executed.** Phase A pass 1 and 1b are complete; the
owner has decided the four open questions. This plan covers what Phase A
deliberately deferred (per-artifact detail) and the binding work that is Phase
B proper.

Phase B answers one question: **for each executable we intend to run, can we
show it was produced from source we have reviewed?** It does not answer whether
running it is safe (Phase C) or whether it behaves correctly (step3).

## The headline, stated up front

**No artifact currently on either Mac will come out of Phase B as
source-verified, and Phase B is not going to try to make one.**

That is not a failure; it is the honest shape of the problem:

- The stock imsg on both hosts is a **Homebrew bottle** — a binary this project
  did not build and cannot rebuild bit-for-bit.
- The dedicated Node runtimes are **official upstream binaries**, and pass 1
  found that **neither host retains the archive** they came from.
- The retained candidate/release builds were built by this project, but from a
  machine state we can no longer reconstruct, and byte-for-byte reproduction was
  never assumed.

So Phase B's deliverable is a **classification with an explicit ceiling on what
each class may be used for**, plus the list of artifacts Phase D must rebuild.
The one thing Phase B must not do is let a matching digest be read as
provenance. A digest match proves *unchanged since that record*. It says nothing
about what the bytes were built from.

## Decisions carried in from Phase A

| Decision | Effect on Phase B |
|---|---|
| Re-pin the audit to imsg `0.15.3`, do not revert | M1's pinned source is `f2455d9`; the stored patch is re-pinned, not re-authored. `0.15.1` no longer exists on that host. |
| Stop the Intel agents only in a bounded window at measurement time | Phase B touches nothing. The foreign imsg process stays running and is recorded as present throughout. |
| Serve is empty on both hosts | Closed. Not revisited. |
| Accept "M1 build tree not found"; rebuild rather than investigate | M1 has **published digests with no surviving artifact**. Phase B records that asymmetry instead of hunting for the tree. The unreadable directory is not opened, chmod-ed or removed. |

## B1 — Pass 2: per-artifact detail on both Macs (read-only)

Same contract, generator and guards as Phase A: no imsg, no node execution, no
`sudo`, no writes, no signals, no `launchctl`/serve mutation, no discarded
stderr, every path bounded, raw output straight to the private evidence
directory with only derived verdicts surfaced.

Pass 2's script is generated **from pass 1's actual output**, not from guesses.
For each path pass 1 found:

```sh
shasum -a 256 "<path>"
stat -L -f "%Sp %Su:%Sg %z %Sm %N" "<path>"
file -bL "<path>"
xattr -l "<path>"
codesign -dvvv "<path>"; echo "codesign exit: $?"
codesign -d --entitlements - "<path>"
lipo -archs "<path>"          # CLT present on both, confirmed in pass 1
otool -L "<path>"
otool -l "<path>" | grep -A2 LC_RPATH
```

Targets, in order:

1. **The dedicated Node executable** on each host.
2. **The stock imsg `libexec` image** on each host. Digests were already taken
   in pass 1b; this adds signature, entitlements and linked libraries.
3. **Each retained release tree** (`9b64d36-p0c1`, `a342425` on both hosts):
   bounded file count, and the digest of any archive found inside.
4. **The Intel build trees** — `baseline`, `candidate`, and the unrecorded
   `candidate-r3`: digests of `Package.swift` and `Package.resolved`, `git
   rev-parse HEAD`, and `git --no-optional-locks -c core.fsmonitor=false -c
   core.untrackedCache=false status --porcelain`, preceded by an `index.lock`
   check that aborts that tree if a lock already exists. Any built product under
   `.build` is hashed but **not executed**.
5. **The two project plists** inside the base directory: digest and content.

Explicitly **not** collected: the contents of the `owner.json` state files. They
sit under per-owner state directories and may carry an owner key or its hash.
Their existence, mode and size are recorded; **they are not read or hashed**.

Abort conditions are inherited unchanged from the Phase A plan, plus: a
pre-existing `.git/index.lock` in any build tree aborts that tree only.

## B2 — Bind the Node runtimes to the official release (no Mac contact)

Pass 1 found no retained Node archive on either host, so there is nothing on the
Mac to compare against the official checksum. That looks like a dead end and is
not one.

Archive extraction is deterministic. On this workstation:

1. Download `node-v24.20.0-darwin-x64.tar.gz` and
   `node-v24.20.0-darwin-arm64.tar.gz` plus `SHASUMS256.txt` from the official
   distribution.
2. Verify each archive against the checksum file (the two expected values are
   already published in `docs/`).
3. Extract, and compute the SHA256 of `bin/node` inside each.
4. Compare against the digests B1 collects from the two Macs.

A match binds each Mac's runtime to a specific official release image. That is
**still not source provenance** — it is upstream-binary identity, and the
checksum file itself was fetched over HTTPS rather than signature-verified — but
it is a large improvement over "no prior record", and it is cheap.

A mismatch is a real finding: it would mean the executable on that host is not
the one that official archive contains.

Nothing is copied to, installed on, or removed from either Mac.

## B3 — Re-pin the imsg sources and bind the build inputs

On this workstation, from the existing pinned upstream clone:

1. Keep the `0.14.2` worktree at `c99e6d0` (Intel's stock version, unchanged).
2. Add a `0.15.3` worktree at `f2455d9` (already created and verified during the
   upgrade assessment).
3. Re-verify both stored patches apply with `git apply --check`. Record the
   patch digests again.
4. Compute the digests of `Package.swift` and `Package.resolved` **in the pinned
   source**, for patched and unpatched states.

Then compare those against what B1 collected from the Intel build trees. This
comparison is the actual binding test available to us:

- If an Intel tree's `Package.resolved` matches the pinned source's, that tree's
  dependency graph is the reviewed one.
- If its `git rev-parse HEAD` is the pinned commit **and** `status --porcelain`
  is empty except for the patch's own changes, that tree's source is the
  reviewed source.
- Neither of those binds the **binary** in that tree's `.build` to that source.
  Nothing available to us does. A built product is bound to its inputs only by
  having watched the build happen, which is Phase D.

`Package.resolved` for `0.15.3` will differ from the published `0.15.1` value.
That is a **new pin**, not a divergence, and is recorded as such.

## B4 — Classify every artifact

Each artifact lands in exactly one class, with a stated ceiling:

| Class | Meaning | May be used for |
|---|---|---|
| **R — Reproducible** | Rebuildable in Phase D from pinned upstream + stored patch + pinned lock, on a recorded toolchain | Measurement, after Phase C and D |
| **U — Upstream binary** | Third-party image we cannot build: Homebrew bottles, the Node runtimes | Running the app (Node) or as the *user-visible* stock CLI. **Not** as a measurement baseline |
| **H — Historical** | Retained artifact whose digest matches a published record | Evidence that a past result was taken on those bytes. **Never** a measurement artifact |
| **X — Unresolved** | No prior record and not reproducible | Nothing, until resolved or excluded |

Expected placements, to be confirmed rather than assumed:

- Node runtimes → **U**, upgraded from X by B2 if the digests match.
- Stock imsg on both hosts → **U**.
- `a342425` → **H**, and explicitly sealed: the handoff already forbids it as a
  measurement artifact because it predates the current no-launch and sample
  fixes and can reach unsafe diagnostics.
- `9b64d36-p0c1` → **H**.
- Intel `baseline` / `candidate` trees → sources likely **R**; their built
  products **H** at best.
- Intel `candidate-r3` → **X** until identified. An unrecorded third tree is
  exactly the kind of artifact that gets quietly promoted to "verified" by
  familiarity.
- M1 published digests (release A/B, debug candidate, `0.15.1`
  `Package.resolved`) → **H with no surviving artifact**. They cannot even be
  re-matched. Recorded as historical-only and not counted as evidence about
  anything currently on that machine.

## B5 — A deliberate consequence for measurement design

The stock bottles are class **U**. If the measurement baseline were the stock
CLI, the A/B would differ by *both* the patch and the entire build provenance,
and no amount of careful timing would separate those.

So Phase B's recommendation, to be confirmed before Phase D: **build both the
baseline and the candidate ourselves**, from the same pinned source and lock, on
the same toolchain, differing only by the stored patch. The stock bottle then
stops being part of the experiment and goes back to being what the owner runs.

This mirrors what the historical comparisons already did, and it is the only
arrangement in which "same target, same payload, same names" is a claim about
the patch rather than about Homebrew.

## B6 — Output

1. A provenance table in `docs/`: every artifact, its class, its ceiling, and
   what would be required to raise it. Digests only; no private paths.
2. The Phase D rebuild list: exactly which artifacts must be built fresh, for
   which architecture, from which pinned inputs.
3. The sealed list: artifacts retained as historical evidence that no later
   phase may use. **Nothing is deleted**, and nothing on the earlier deletion-
   candidate list is acted on.
4. Private detail — resolved paths, per-host digests, signature output, linked
   libraries — into the Vault note.

## What Phase B cannot conclude

That any Mac artifact was built from reviewed source. That a class-U binary is
trustworthy beyond its upstream identity. That a reproducible classification
means a successful rebuild — Phase D has to actually do it, and it may fail. That
the injected bridge helper already present on the Intel host matches any version
we have reviewed. That a launch environment is safe: import, native and helper
closure, `DYLD_*` and `NODE_*` handling, and the new
`IMSG_LAUNCH_READY_TIMEOUT` knob are all Phase C.

And, unchanged from every previous phase: **no authorization to execute `imsg`
is created by anything in Phase B.**

## F2 review scope

F2 is the pre-agreed Fable review point for this phase, to be run on this plan
before B1 executes. Scope:

- Is any digest match, anywhere in this plan, doing the work of provenance?
- Does any artifact get promoted between classes without a stated reason —
  particularly `candidate-r3`, and particularly the Node runtimes via B2?
- Is B2's determinism claim about archive extraction actually sound, and is its
  stated ceiling ("upstream identity, not source provenance, checksum fetched
  over HTTPS") accurate?
- Does B3's binding argument overstate what `git status` plus a matching
  `Package.resolved` can establish about a built product?
- Is the B5 recommendation reasoning correctly about what the stock bottle would
  confound, or is it substituting one unverified baseline for another?
- Does the pass 2 command set introduce any side effect, or read anything it
  should not — specifically the `owner.json` exclusion and the `git status`
  form?

---

# B2 and B3: executed (workstation only, no Mac contact)

The two parts of this plan that need no Mac were run while F2 review was in
flight. Nothing was sent to, installed on, or read from either Mac.

## B2 — official Node release images

Both Darwin archives were downloaded and verified against the official
`SHASUMS256.txt`, whose two values also match what `docs/` already published.
The `bin/node` digest was then taken **straight out of the archive stream**,
without extracting to disk, and cross-checked against an on-disk extraction:

| Archive | `bin/node` SHA256 |
|---|---|
| `node-v24.20.0-darwin-x64.tar.gz` | `bb37f3a05d1104a9ca2488718a32ff07f3d0725b7b7b6a04bb26a5af7213fe12` |
| `node-v24.20.0-darwin-arm64.tar.gz` | `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a` |

Stream and extracted digests are identical, which is the point: the value is a
hash of file **content**, so extraction permissions, ownership, timestamps and
extended attributes cannot affect it. On macOS, extended attributes such as
quarantine live outside the data fork and do not change it either.

These are the expected values for the two Mac runtimes. The comparison itself
needs pass 2 and has **not** been made. The ceiling is unchanged: a match would
establish *upstream binary identity*, not source provenance, and the checksum
file was fetched over HTTPS rather than signature-verified.

## B3 — pinned sources and build inputs

Both pinned commits are exactly their release tags, confirmed by `rev-parse`:
`c99e6d0` is `v0.14.2` and `646ea7a` is `v0.15.1`. The 0.15.3 worktree is at
`f2455d9`. All three worktrees are clean.

The stored patches touch five files — `ContactCatalog.swift`,
`ContactResolver.swift`, `RPCServer+Handlers.swift` and two tests — and
**neither `Package.swift` nor `Package.resolved`**. So patched and unpatched
trees have identical build inputs, and only one digest per version is needed.
Both patch digests re-match their published values.

| Pinned source | `Package.swift` | `Package.resolved` |
|---|---|---|
| v0.14.2 (`c99e6d0`) | `507c9e98ff3b67d55824b5ebb4dd7392b8c8006a20e5ff692513cd293438b6a4` | `e1ca69b100415d738ef9e7b48822bb4229131fb6112686c7b896614fd17668e5` |
| v0.15.1 (`646ea7a`) | — | `be55852d84140bb12cbf4c58bb67f8260337878837e80d6ddeef41f259a3ae00` |
| v0.15.3 (`f2455d9`) | `b3fa12d78aeadf6d1a1ce8872ebe6ad9c54af75bdfe815307402323a9a1ff769` | `be55852d84140bb12cbf4c58bb67f8260337878837e80d6ddeef41f259a3ae00` |

In each file, SwiftPM's `originHash` equals this table's `Package.swift` digest,
which is a useful internal consistency check.

### Correction: the 0.15.3 lock is not a new pin

This plan predicted that `Package.resolved` for 0.15.3 would differ from the
published 0.15.1 value and would have to be recorded as a new pin. **That was
wrong.** v0.15.1 and v0.15.3 have byte-identical `Package.resolved`, and its
digest is exactly the published M1 value `be55852d…`.

So the M1 build-input record survives the upgrade untouched, and it binds
directly to reviewed upstream source rather than to a machine. One less thing
to re-establish.

### Finding: the Intel build-input record does not match upstream

The published Intel `Package.resolved` digest is
`119d9373e83738fb78819106065d119fcb53b262a77a97c1c087bf01aba273e9`. The pinned
upstream v0.14.2 `Package.resolved` is `e1ca69b1…`. **They differ.**

The record describes `119d9373…` as the lock retained by *both* Intel build
trees, so it is consistent between baseline and candidate — it is consistent
with itself, and inconsistent with the reviewed upstream input. This is exactly
the confusion this phase exists to catch: a digest that was recorded as a
"tracked build input" and matched across two trees, while never having been
compared to the source it was supposed to come from.

The pinned commit is not the explanation: `c99e6d0` is `v0.14.2` exactly.

Hypotheses, none of them yet tested:

1. SwiftPM rewrote the lock during resolution on that machine — a different
   toolchain, a moved dependency, or a lock-format change.
2. The trees were seeded from a release tarball or another ref rather than from
   the pinned commit.
3. The recorded digest was taken after a build rather than before.

**Amendment to B1:** pass 2 must collect the Intel trees' `Package.resolved`
**content**, not only its digest, so it can be diffed against upstream. The file
is a small JSON of dependency URLs, revisions and versions; it carries nothing
private and its diff can be published.

Until that diff exists, the Intel candidate and baseline binaries must be
treated as built against an **unverified dependency graph**, and the recorded
"tracked inputs matched" claim must not be read as "matched the reviewed
source". It never said that; it was read that way.
