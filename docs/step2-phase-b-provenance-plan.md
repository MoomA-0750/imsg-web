# Step2 Phase B — source-to-artifact provenance plan

Status: **B1 not executed; B2 and B3 executed on this workstation only.** No
Mac has been contacted for this phase. Phase A pass 1 and 1b are complete; the
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

**Corrected after F2.** The first draft proposed to bind a tree by checking that
`git rev-parse HEAD` equals the pinned commit and `status --porcelain` is empty.
That rule is wrong for the trees we actually have. `experiments/contact-batch/README.md`
records that the candidate trees carry the patch **as commits** (`08b50a7` then
`6ded519` for 0.14.2), so a candidate tree's `HEAD` is by definition *not* the
pinned commit and its working tree is *clean*. The rule would have failed to
bind the one tree that matters, leaving only "the directory is called
candidate" — which is precisely the promotion-by-familiarity this phase forbids.
Those candidate commits are local to the Mac and do not exist in this
workstation's clone, so comparing commit IDs binds nothing either.

The binding is done on **tree hashes** instead, which are content-addressed and
carry no commit metadata:

1. On the workstation, construct each candidate state in a scratch worktree —
   pinned commit, pinned commit + stored patch, and pinned commit + patch +
   the resolved lock — and record `git write-tree` for each.
2. Pass 2 collects `git rev-parse HEAD^{tree}` from each Mac tree (read-only).
3. A tree-hash match binds that tree's **contents** to a state we constructed
   from reviewed inputs, regardless of how the commits were arranged.

Two limits stay explicit. A `Package.resolved` match means the lock file is
identical to the pinned one; it does not mean the dependency graph was reviewed.
And none of this binds the **binary** under that tree's `.build` to that source.
Nothing available to us does: a built product is bound to its inputs only by
watching the build happen, which is Phase D.

## B4 — Classify every artifact

Each artifact lands in exactly one class, with a stated ceiling:

| Class | Meaning | May be used for |
|---|---|---|
| **R — Rebuilt under observation** | Built in Phase D, in a fresh directory, from pinned upstream + stored patch + a reviewed lock, on a recorded toolchain. **R does not mean bit-reproducible**: Swift release builds are not. | Measurement, after Phase C and D |
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
- Intel `baseline` / `candidate` trees → **H or X**, never R. R is reserved for
  artifacts Phase D builds itself. Calling an existing tree "R" invites reusing
  its `.build`, where SwiftPM's incremental build can carry objects from a
  different source state into the output. Phase D builds in a **fresh
  directory**; the existing `.build` is neither reused nor deleted.
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

In each file, SwiftPM's `originHash` equals this table's `Package.swift` digest.

**Corrected later:** that is a coincidence of these two versions, not a rule. At
v0.15.4 the lock's `originHash` is `1668c8b5…` while `Package.swift` hashes to
`0785085f…`. Treating it as a consistency check would have been wrong, and the
difference matters: a host whose SwiftPM computes a different `originHash` will
treat the lock as stale and rewrite it. See `docs/step2-phase-d-build-plan.md`.

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

### Correction: this was already explained in this repository, and I did not look

The section above originally listed three untested hypotheses. That was a
research failure, not a discovery. `experiments/contact-batch/README.md` states
it plainly:

> The 0.14.2 pinned lock lacked transitive entries and required isolated
> resolution preserving direct pins; the exact resulting lock digest is recorded
> in the preflight evidence.

So `119d9373…` is the **re-resolved** lock, and `docs/custom-read-preflight-record.md`
is the preflight evidence that records it. Hypothesis 1 was not a hypothesis; it
was a recorded fact, four directories away, found by reading the repository
rather than by reasoning about it. The lesson is the same one this phase keeps
producing: check what is already written down before treating a mismatch as an
anomaly.

### The real remaining gap

Knowing *why* the lock differs does not close anything. What the records contain
is a **digest** of the re-resolved lock; what they do not contain is any review
of its **contents**. Isolated resolution that "preserves direct pins" still
chooses transitive versions, and nobody has checked which ones it chose.

So the accurate statement is narrower and sharper than the original finding: the
Intel builds used a dependency graph that was resolved on that machine, recorded
by digest, and **never reviewed**. The recorded "tracked inputs matched" claim
means baseline and candidate matched each other. It never claimed agreement with
upstream, and must not be read as such.

**Amendment to B1:** pass 2 collects the Intel trees' `Package.resolved`
**content**, not only its digest, so its transitive choices can be diffed
against upstream and reviewed. The file is a small JSON of dependency URLs,
revisions and versions; it carries nothing private and its diff can be
published.

---

# F2 review dispositions

Pre-agreed review point for the provenance-binding logic, run on the plan
including the B2/B3 results (the reviewer noted the document grew mid-review;
the reviewed version is the one ending at the B3 section above). Ten findings.
No path to a destructive Mac operation, an imsg or node execution, or a secret
read was found in the plan.

Two blockers, both "the plan cannot execute as written" rather than safety:

| # | Finding | Disposition |
|---|---|---|
| 1 | Pass 2 cannot be generated by the Phase A generator: `git` is in its forbidden-command list, `--pass 2` is rejected, and the find-root allow-list excludes release and Cellar paths | **Adopt. Blocker.** Add a pass-2 mode with `git` allow-listed to the exact non-locking read-only forms (`rev-parse`, `status --porcelain`), extend the find-root allow-list to the literal paths pass 1 found, add refusal tests, and run a focused re-review of the changed generator before B1 |
| 2 | The tree-binding rule is wrong for the trees that exist: the README records that candidate trees carry the patch **as commits**, so `HEAD` is not the pinned commit and the working tree is clean | **Adopt. Blocker.** Verified: the four candidate commits named in the README are absent from this clone, so commit IDs bind nothing. Binding switched to content-addressed tree hashes, reconstructed locally with `write-tree` and collected from the Macs with `rev-parse HEAD^{tree}` |
| 3 | Stock imsg enters class U on assertion alone, while Node had to earn it by digest match; and "Homebrew bottle" is itself unverified — a universal binary is unusual for a locally built bottle | **Adopt, with an owner decision.** Pass 2 will read the keg's `INSTALL_RECEIPT.json` and `.brew/imsg.rb` (file reads only; `brew` stays forbidden) and inventory the keg's helpers with digests. U splits into **U-bound** (digest matches a published upstream asset) and **U-unbound** (origin asserted only), with U-unbound capped at X. Whether stock imsg must be bound at all depends on the production-executable decision below |
| 4 | Which lock is the 0.14.2 pin is undecided, yet R's definition and the Phase D rebuild list depend on it. The upstream lock lacks transitive entries | **Adopt, with an owner decision.** Added a B3 step to choose and review the 0.14.2 pin lock explicitly |
| 5 | Sealing class H is a declaration with no mechanism | **Adopt.** The sealed digests go into a fail-closed deny-list in the launch-agent generator, the bundle verifier and the measurement harness, with tests. Recorded as typo-prevention, not a defence: one changed byte evades it. Also recorded: H artifacts under the temporary root are not guaranteed to persist |
| 6 | Pass 2 hygiene: `shasum` on a FIFO blocks forever; the `index.lock` check misses linked worktrees; the start/end `ps` diff spans two sessions and is meaningless; `.build` hashing is unbounded; `xattr` can surface a download URL | **Adopt all five.** Hash only `-type f`; resolve the git dir with `rev-parse --git-dir`; take `ps` at both ends of pass 2 itself; name the product paths explicitly and record symlink targets with `stat -L`; never surface xattr values in extraction |
| 7 | The document's status line contradicted the executed sections | **Adopt.** Status corrected |
| 8 | B2 is sound and its ceiling accurate; optionally verify `SHASUMS256.txt.sig`, and cap U's "running the app" with "after Phase C" | **Adopt.** Both are cheap and correct |
| 9 | B5's reasoning is valid, but "R — Reproducible" overstates it, and calling the existing Intel trees R invites reusing a `.build` that can carry objects from another source state | **Adopt.** R renamed to "Rebuilt under observation" and explicitly not bit-reproducible; existing trees demoted to H/X; Phase D builds in a fresh directory. Also recorded: a self-built binary has a different cdhash and does not share the stock binary's TCC grant, so a baseline/candidate pair is internally consistent but is not measuring the owner's actual configuration |
| 10 | `candidate-r3` is fenced but "identified" is undefined | **Adopt.** Defined as a tree-hash match against one of the constructed states plus a product-digest match against a published value; anything else stays X. Its products are not used in Phase D either way |

Finding 2's underlying cause is recorded above in its own section: the
explanation for the Intel lock mismatch was already written in this repository
and was not consulted.

## Owner decisions required before B1

1. **Does production run the stock imsg, or one we build?** The app selects its
   executable by path (`IMSG_WEB_IMSG_PATH`, set by the launch-agent generator),
   so whatever that path points at is an executable we intend to run, and
   therefore a Phase B subject. If production is to run stock, the stock image
   needs binding work it does not currently have. If production is to run a
   build of ours, stock drops to "what the owner runs by hand" and the binding
   burden disappears.
2. **Which lock is the 0.14.2 pin?** The upstream lock lacks transitive entries.
   The choice is between reviewing the contents of the re-resolved lock already
   recorded by digest, or resolving fresh on this workstation and reviewing
   that. Recommendation: review the recorded one first, since it is what the
   existing evidence was produced with; fall back to a fresh resolution only if
   its transitive choices are unacceptable. Either way the contents get read,
   not just the digest.
3. **May Phase D create fresh build directories on the Macs?** Required by the
   decision not to reuse an existing `.build`. Needs disk space and explicit
   permission to create directories, which no phase so far has had.

---

# Owner decisions, and what they changed

| Decision | Effect |
|---|---|
| **Production runs a build of ours, not stock imsg** | Stock drops out of the binding work entirely: it becomes what the owner runs by hand. The owner keeps `brew upgrade` freedom precisely because production no longer depends on it. Pass 2 records the stock images for the record, not to bind them. |
| **Pin both hosts at the latest release, `v0.15.4`** | The 0.14.2/0.15.x split existed only because that is what each machine's Homebrew had. Building ourselves removes it: one version, one patch, one lock, and host differences stop being confounded by version differences. |
| **Lock at that version** | `v0.15.4`'s committed lock is **complete** (4 pins), unlike 0.14.2's, so the upstream lock is used as-is. This is better than resolving fresh: the lock binds to reviewed upstream source rather than to a machine. |
| **Fresh build directories on the Macs are permitted** | Phase D builds in new directories and neither reuses nor deletes the existing `.build`. |

A new standing requirement comes with the first decision: **each time this
project's code is updated, re-check whether to adopt the latest imsg.** The
owner's reason is to avoid silently sitting on an old version years from now.
The check is the same one performed for 0.15.3 and 0.15.4 — diff the audited
files, confirm the patch still applies, and compare the lock — and it must be
written so that it *can fail*, which the first attempt at it did not.

## Reference tree hashes for pass 2

Content-addressed, reconstructed on this workstation. Pass 2 collects
`rev-parse HEAD^{tree}` from each Mac tree and compares against these.

| State | Tree hash |
|---|---|
| v0.14.2 pinned | `c255fa93d930a1974aebfc8209fa317b03ebe373` |
| v0.14.2 pinned + stored patch | `0ada14a4517d31bfe3648905544ce71a5f7e6940` |
| v0.15.4 pinned | `3b9a33155dc66a2c2992a47c53f2c6d89928efb7` |
| v0.15.4 pinned + stored patch | `b7822478d09654ba06a3ecbeb127448234be793e` |

The Intel trees are **not** expected to match these exactly: they carry the
re-resolved lock, which the pinned states do not. If a tree differs from
"pinned + patch" only by `Package.resolved`, that is confirmable once pass 2
returns the lock's content — a third state can then be constructed and the
hashes compared. A difference anywhere else is a finding.

This is also why the comparison is worth doing at all. "The directory is called
candidate" is not evidence; a tree hash is.
