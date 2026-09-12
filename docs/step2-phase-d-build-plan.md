# Step2 Phase D — rebuild under observation

Status: **proposed, not executed.** No Mac has been written to.

Phase D produces the only artifacts this project is allowed to measure: class
**R**, built by us, in a fresh directory, from inputs we pinned and recorded.
Every artifact currently on either Mac is class H, U or X, and Phase B said so
explicitly rather than quietly promoting one.

## This is the first write

Phases A, B and C read. Phase D creates directories and files on both hosts.
That is a change of kind, not degree, and the contract changes with it.

## The probe generator is deliberately NOT reused

`scripts/gen-phase-a.mjs` refuses `mkdir`, `rm`, `chmod`, any redirection, and
every command that could write. That refusal **is** the read-only guarantee for
Phases A, B and C8, and it is enforced by twenty-nine tests.

Phase D is not read-only. Relaxing that generator to let a build through would
retroactively weaken every probe it has ever produced and every probe it will
produce later. So Phase D gets its **own** generator and template, with its own
contract, and the probe generator is left exactly as it is.

The Phase D contract:

- Writes are confined to **one named directory**, created by this phase, under
  the project-owned base. Nothing outside it is created, moved or modified.
- **No `rm`, no `chmod` outside that directory, no `sudo`, no `launchctl`, no
  `tailscale`, no `brew`, no `git` that writes outside the build root.**
- **`imsg` is never executed.** Building a binary is not running it, and the
  admission chain that gates execution is untouched by this phase.
- The stock `imsg`, the dedicated Node runtimes, the existing build trees and
  the retained releases are not touched, not reused and **not deleted**.

## D1 — The source reaches the Mac as fixed bytes

`swift build` needs a source tree. Two ways to get one there, and they are not
equivalent.

Rejected: `git clone` on the Mac. It would make the Mac's network fetch the
authority on what got built, and "the tag resolved to the same thing" is a claim
we would then have to make rather than a fact we already hold.

Adopted: the tree is assembled **on this workstation** from the pinned worktree
plus the stored patch, archived, and the archive digest recorded. The archive is
transferred and its digest re-checked on the Mac before extraction. The inputs
are then identical by construction, and the reference tree hashes computed
during Phase B apply directly:

| State | Tree hash |
|---|---|
| v0.15.4 pinned | `3b9a33155dc66a2c2992a47c53f2c6d89928efb7` |
| v0.15.4 pinned + stored patch | `b7822478d09654ba06a3ecbeb127448234be793e` |

Dependencies are a different matter. SwiftPM resolves and fetches them on the
build host, at the revisions `Package.resolved` pins, so the Mac does need
network for that step. That is acceptable because the revisions are pinned — but
it is why the next item exists.

## D2 — The lock is recorded before and after every build

`Package.resolved` digest is taken **immediately before** `swift build` and
**immediately after**. Expected value, from v0.15.4's own committed lock:

`61a6573a5e5bee68be9cc8c562e55ca39662033877ec611176734b5af59056c8`

If it changes, the build resolved something the pin did not specify, and
"pinned inputs" was not a property of that build. That is a **finding**, not a
detail to normalise: it is the same class of thing as the 0.14.2 lock that was
re-resolved on a machine and then recorded only by digest, which Phase B spent
real effort unpicking.

## D3 — What is built

Per host, two arms in separate directories under the build root:

1. `baseline` — v0.15.4 unpatched.
2. `candidate` — v0.15.4 plus the stored contact-batch patch
   (`6715e27a40fa5d47a0e9245a5f6f197fc59cb5754d95c0e7c9d6870c9f187b65`,
   verified to apply cleanly to `e2f5046`).

Release configuration, matching what the historical comparisons used. `swift
test` is **not** run: it would execute code from the tree, and this phase builds
without running.

The two arms differ by exactly five files — `ContactCatalog.swift`,
`ContactResolver.swift`, `RPCServer+Handlers.swift` and two tests — which is
verified from the archives before either build starts, not asserted afterwards.

## D4 — What is recorded

Per arm, per host:

- Toolchain: `swift --version` verbatim. The two hosts differ (Swift 6.1.2 on
  Command Line Tools; Swift 6.4 on an **Xcode 27 beta**), and that difference is
  part of the artifact's identity, not background.
- Lock digest before and after (D2).
- Source archive digest, and the extracted tree's digest.
- Product: SHA256, size, architecture, `codesign` output, `otool -L`.
- Build duration, purely as a sanity signal.

Every product digest will be **no prior record**, because no such artifact has
existed before. That is the expected and correct outcome, and it is the reason
class R is defined by process rather than by matching a digest.

## D5 — What Phase D does not establish

That the products behave correctly, or identically to each other, or to the
stock binary. That a beta compiler produces an artifact equivalent to a release
compiler. That either product may be executed — **it may not**, until Phase C's
remaining items and a separate authorization.

Two known consequences carried forward from earlier phases: a self-built binary
has a different code identity from the stock one and therefore does **not**
inherit its permission grants, so a later real-data run may require the owner to
grant access again; and the Intel host runs a foreign long-lived `imsg` owned by
a separate system, which remains a confound for any measurement there.

## D6 — After the build

- Phase C's deferred items become actionable: `safeTree(imsg, uid, true)` becomes
  `false` and `validateConfig` gains a check that the executable sits under the
  base, because the path being validated now exists.
- The Phase B classification is updated: the new products enter as class R, and
  the sealed list of class H artifacts is written with digests.
- Nothing is installed, put on `PATH`, or pointed at by any launch agent.

## F4 review scope

Pre-agreed review point for bundle completeness and independent pinning:

- Does anything in this plan let a generated manifest or a self-reported digest
  stand as its own evidence?
- Is "assemble on the workstation, verify the archive on the Mac" actually
  stronger than cloning there, or does it just move the trust?
- Is the write confinement real? Can the build escape the named directory —
  through SwiftPM caches, `~/.swiftpm`, a module cache, or a toolchain default?
- Does building without running genuinely avoid executing project code, given
  SwiftPM plugins and build-tool plugins exist?
- Is the before/after lock check sufficient to detect resolution drift, or can a
  build mutate inputs in a way it would not catch?
- Does the plan omit any artifact that Phase D must produce for Phase C's
  deferred checks or for step3's measurement to be possible?

---

# F4 review dispositions

No route to executing `imsg`, `sudo`, `launchctl`, deleting anything, or reading
a secret was found. But four findings say the plan's own guarantees — write
confinement, pinned inputs, "does not run code", and artifact completeness — do
**not** hold as written. Each was verified directly before adoption.

## Verified corrections

### The product is not one file

`PhoneNumberNormalizer.swift:5` constructs a `PhoneNumberUtility()`, and
`ContactResolver` uses it on the **read path** — the same path the contact-batch
patch changes. PhoneNumberKit ships its metadata as a SwiftPM **resource bundle**
emitted next to the executable, and upstream treats it as a shipped product:
`scripts/build-universal.sh` copies `*.bundle` alongside the binary, and
`docs/RELEASING.md` requires "at least one Swift resource bundle".

The plan recorded only the executable's digest. **Adopted:** the recorded product
is the executable *plus* a per-file manifest of the adjacent `*.bundle`, at
realpath. `.build/release` is a symlink to `.build/<triple>/release`, and
`safeTree()` rejects a symlink in any path component, so the deferred Phase C
check must be pointed at the resolved path.

### `swift build` without `patch-deps.sh` is not what upstream ships

This is the most consequential thing F4 surfaced, and it goes further than the
review stated. Upstream's `Makefile` runs `scripts/patch-deps.sh` before **every**
build, and that script rewrites files inside `.build/checkouts/`:

- `PhoneNumberKit/.../Bundle+Resources.swift`: `#if DEBUG && SWIFT_PACKAGE`
  becomes `#if SWIFT_PACKAGE`, and `Bundle.main.bundleURL.resolvingSymlinksInPath()`
  is added to the search list.
- `SQLite.swift/Package.swift` adds `"PrivacyInfo.xcprivacy"` to an exclude
  list — **but at the pinned 0.16.0 that file already declares it, so the script
  exits early and this half is a no-op.** Corrected after checking the real
  dependency source; the first version of this line said it was rewritten.

Read plainly: **upstream's PhoneNumberKit searches next to the executable for its
resource bundle only in DEBUG builds.** A plain release build without this patch
may not find its phone-number metadata at all — on the contact path, in the arm
whose contact behaviour we are trying to measure.

`Package.resolved` does not change when this happens. It is a documented,
upstream-sanctioned example of a build input being mutated in a way the lock
digest cannot see, which is exactly what D2 was written to catch and cannot.

**Adopted:** Phase D applies `patch-deps.sh`, because building without it
produces something upstream never ships. The mutation is made visible instead of
avoided: each `.build/checkouts/<dep>` gets `rev-parse HEAD`, `HEAD^{tree}` and
`status --porcelain` recorded **before and after** patching, so the change is
pinned by content rather than trusted.

Whether the historical comparisons applied it is **not established** — the record
does not say. The M1 arm returned 15 named rows, which implies PhoneNumberKit
worked there, but that is an inference and is recorded as one.

### The lock check would have fired on every build

Phase B recorded that `originHash` equalled the `Package.swift` digest in both
0.14.2 and 0.15.3, and called it a useful consistency check. **That was a
coincidence of two versions, not a rule.** At v0.15.4 the lock's `originHash` is
`1668c8b5…` while `Package.swift` hashes to `0785085f…`. The earlier note is
corrected rather than left standing.

The consequence F4 drew is real: if a host's SwiftPM computes a different
`originHash`, a plain `swift build` treats the lock as stale, re-resolves, and
rewrites `Package.resolved` — so D2 would fire every time, for a reason that is
not "the build resolved something the pin did not specify".

**Adopted:** build with `--force-resolved-versions` so resolution failure is an
error rather than a silent rewrite, with the branch decided **in advance**: if it
fails, run `swift package resolve` alone and diff the `pins` array against the
committed lock. Pins identical and only `originHash` differing is recorded as
such and the build continues with the new digest recorded; any change to `pins`
stops the phase. The historical comparisons used `force-resolved-versions` and
`skip-update`, which D3 claimed to match and did not.

### "Builds but does not run" was wrong

The root `Package.swift` declares no plugins — verified. But `Package.swift`
itself is Swift that SwiftPM **compiles and executes**, for the root and for each
of the four dependencies, before any build starts.

**Adopted:** the claim becomes "the build's *products* are never executed; five
package manifests are executed under SwiftPM's sandbox, and `--disable-sandbox`
is never passed." The four dependency manifests are fetched with plain `git` on
this workstation at their pinned revisions and checked for `.plugin(` / `plugins:`
before anything runs on a Mac — which also yields dependency tree hashes for
independent pinning.

### Write confinement

`swift build` writes to `~/Library/Caches/org.swift.swiftpm`, `~/.swiftpm`,
`~/Library/org.swift.swiftpm/security` and `$TMPDIR` by default. **Adopted:**
`--scratch-path`, `--cache-path`, `--config-path` and `--security-path` are all
set under the build root and `TMPDIR` points there too; and confinement becomes
an **observation** rather than a claim — a marker file at the start, then a
bounded `-newer` sweep of those default locations at the end, names only. A
non-empty sweep is a finding.

## Other findings adopted

Recording the exact `swift build` command line (class R is defined by process, so
an unrecorded process defines nothing); `LC_BUILD_VERSION` plus
`xcrun --show-sdk-version` so "built against a beta SDK" is a fact rather than an
inference; the beta caveat extended from the compiler to the SDK, linker and host
OS; both arms built in one session with `swift --version` taken immediately
before each; tree-hash comparison stated as fail-closed verification rather than
recording; a completeness marker; failed arms left in place under a new name
rather than deleted or reused; build logs to the private evidence directory only.
No debug build: step3 measures release. `imsg-bridge-helper.dylib` is not built
by `swift build` and is deliberately not produced.

## Owner decisions

1. **Dependency fetching on the Mac.** Either allow it (revisions are pinned and
   git verifies every object against its hash, so a tampered remote fails closed
   rather than substituting content), or ship a bare mirror in the archive and
   build with no network. Recommendation: **allow it, and verify by content
   afterwards** via the checkout tree hashes above, which produces the same
   evidence with far less machinery.
2. **The first execution of `imsg` gets its own approval point.** Phase C says
   its remaining items are checked "against the real binary in Phase D's
   non-launch tests" while Phase D says nothing may be executed — a circular
   dependency, and the kind where a first execution happens without anyone having
   approved it. Recommendation: **Phase D builds only**, and first execution
   becomes its own phase with its own authorization.
3. **Signing.** Upstream release-signs ad-hoc with entitlements; the historical
   artifacts were linker-signed on M1 and **unsigned** on Intel. Signing changes
   bytes, so it cannot be added after a digest is recorded. Recommendation:
   **do not sign in Phase D**; record whatever `codesign` reports.

---

# Decisions taken, and the dependency pre-check (2026-09-12)

All three owner decisions went to the recommendation:

1. **Dependencies may be fetched on the Mac.** Revisions are pinned and git
   verifies every received object against its hash, so a tampered remote fails
   closed rather than substituting content. Content is pinned after the fact by
   recording each checkout's tree hash.
2. **Phase D builds only.** First execution of `imsg` becomes its own phase with
   its own authorization. The circular reference in the Phase C plan is
   corrected.
3. **Nothing is signed in Phase D.** Whatever `codesign` reports is recorded.

## Dependency pre-check: no plugins, and the bundle problem is real

Performed on this workstation before touching either Mac. All four dependencies
fetched with plain `git` at the exact pinned revisions, which also gives the
independent content pins F4 asked for:

| Dependency | Revision | Tree hash | `Package.swift` SHA256 |
|---|---|---|---|
| commander 0.2.4 | `bd219c4e…` | `2814612c71b97ac93978073dd128a0fb8984f7c6` | `fa735819a9f278fabf2dd8f919f38ce55f8de7e2bc7b08f40e3ea5cda371006a` |
| csqlite 3.53.3 | `8ad83035…` | `bfd936184d29e7c2a85fd7ddd088ee81286e0585` | `ef86ba3e2559088995194414f5c2a6232fb02e19ae996e57b6cb1776e869a8e4` |
| phonenumberkit 5.0.9 | `15c27dbf…` | `a811a05da7173ecf90977b34bc14deb8a429e39d` | `59ee8e3d158a8d65538a07d499bc7e9478fa41b5b229678dde6891697c3f1da3` |
| sqlite.swift 0.16.0 | `964c300f…` | `aa747675b7c6229ee4320ce55ca3f01be7d07eb6` | `877bc3bd5013d595b8ef4be61989fbe1df8ed6b074ebb9bbdd8921a67d1f3afe` |

**No plugins in any of them** — no `.plugin(`, no `plugins:`, no
`PackagePlugin` import, no `Plugins/` directory. So the only project code the
build executes is the five package manifests, under SwiftPM's sandbox, exactly
as the corrected claim states.

### What happens without `patch-deps.sh`, precisely

`PhoneNumberKit/Sources/PhoneNumberKit/Bundle+Resources.swift` gates its whole
candidate search on `#if DEBUG && SWIFT_PACKAGE`. In a **release** build that
block is compiled out and resolution falls through to:

```swift
#if SWIFT_PACKAGE
return Bundle.module
```

`Bundle.module` is SwiftPM's synthesized accessor, and it **`fatalError`s when
the bundle is not found**. So a release build without the upstream patch does
not degrade when the metadata bundle is missing or sits behind a symlink — the
process dies, on the contact path, in the arm whose contact behaviour is the
thing being measured.

That is why `patch-deps.sh` both widens the search to release builds and adds
`Bundle.main.bundleURL.resolvingSymlinksInPath()`. And the symlink half is not
incidental: `.build/release` is itself a symlink to `.build/<triple>/release`.

This settles the disposition. Phase D applies `patch-deps.sh` because the
alternative is an artifact that can crash where upstream's does not, and it
records each checkout's tree hash before and after the patch so the mutation is
pinned by content rather than trusted.

It also raises the priority of keeping the `.bundle` beside the executable
wherever the artifact is later placed — a detail that, left to a later phase,
would have surfaced as a crash rather than as a missing file.


---

# F4 stage 2 dispositions — the scripts themselves

The first F4 pass reviewed the plan and said so: "this is a review of the plan;
the scripts that actually run are unreviewed". This is that second pass, on the
generated artifact. **Two blockers**, both verified before adoption.

## Blocker: unquoted flag expansion would have written outside the root

The template collected SwiftPM's path flags into one variable and expanded it
unquoted. The build root contains a space. Verified under a POSIX shell:

```
--cache-path
/Users/…/Library/Application
Support/…/phase-d/swiftpm-cache
```

`--cache-path` would have pointed at `/Users/…/Library/Application` — **outside
the build root, on the very first run**, which is precisely the contract this
phase exists to keep. Every flag is now written inline and quoted, and the
generator refuses a `--cache/config/security/scratch-path` whose value is not
under the root, plus any other `--*-path`.

This is the same failure as the parser bug fixed hours earlier — a quoted value
containing a space — reintroduced in a different file. Finding it twice in one
day is the argument for the review point existing.

## Blocker: `mkdir -p` made a re-run silently reuse the previous one

`mkdir -p` succeeds on an existing root, so a second run after a failure would
have reused the previous `.build` and checkouts, shown the previous patch in the
"before patch" status, and re-touched the marker so the earlier run's outside
writes vanished from the sweep. `-p` also creates missing parents, so a mistyped
root would quietly create a chain of directories.

Now `mkdir "${ROOT}"` without `-p`: an existing root or a missing parent exits
71. A re-run must use a new root name, which is also how "failed arms are left
in place" is actually implemented — the plan claimed it while the generator
forbade `mv`.

## Also adopted

- **`rev-parse HEAD^{tree}` cannot pin what `patch-deps` does.** A tree hash
  comes from the commit and does not move when the working tree is edited, so
  the plan's "pinned by content" was not implemented by what the template did.
  The two patch targets now get file digests before and after.
- **The script exited 0 on almost every failure.** Resolve failure, patch
  failure, build failure and a missing product all fell through to the next
  step and ended on `date`. Each stage now stops its arm, and a `SUMMARY`
  reports per-arm status with exit 73 when either is not `ok`.
- **A changed pin is now what stops an arm**, not a changed lock digest: the
  four pinned revisions must still be present after resolve. The digest can move
  for reasons other than a changed dependency, which is the whole originHash
  problem.
- `.bundle` manifest depth raised from 3 to 6 — the payload sits at
  `Contents/Resources/<file>`, so depth 3 would have recorded `Info.plist` and
  missed the phone-number metadata.
- Marker written before the first toolchain query; sweep depth raised to 6.
- The full `swift build` command line is echoed, since class R is defined by
  process and an unrecorded process defines nothing.
- `xcrun --show-sdk-build-version` added.

## The generator became an allow-list

`"${PRODUCT}" --version` **passed** the deny-list version: the word contains
`$`, so the command name was blanked and every check skipped — which would have
executed the artifact this phase is forbidden to run. A deny-list that blanks
what it cannot parse is not a deny-list.

Commands are now allow-listed; a command name coming from a variable is refused
rather than skipped; write roots are separated from read roots (`mkdir
"${HOME}/x"` previously counted as confined); `tar` must carry `-C "${ROOT}"`
and may not use `-P`; fd-numbered redirections are checked; `swift` is limited
to three shapes, since `swift run` executes the product and `swift package
clean` deletes.

Four segmentation bugs surfaced while doing this, each found because the
control case failed rather than because a check passed: `NAME=$(cmd)`
assignments, `for NAME in <list>`, locally defined shell functions, and `2>&1`
being split on `&` so the redirection target looked like a command named `1`.

Thirty-two guard cases now pass, twelve of them for bypasses that the earlier
version accepted.
