# Step2 Phase E — native, helper and IPC closure (2026-09-13)

What does the artifact we built actually load, and what does it touch? Answered
from the built products and the pinned source. **Nothing was executed**, and no
new writes were made to either Mac: every command here was a read.

Phase E is the last step of step2 that can be done without running anything.
What it cannot settle is listed at the end and hands off to a separate
first-execution phase with its own authorization.

## E1 — Native closure: every dependency is OS-provided

`otool -L` on all four class-R products. Across both hosts and both arms:

**Zero non-system references.** No `@rpath`, no `@loader_path`, no
`@executable_path`, nothing under `/opt/` or `/usr/local/`. Every entry is a
`/System/Library/Frameworks/…` framework or a `/usr/lib/…` library.

The linked set is the same on both hosts apart from platform-specific Swift
shims (`libswiftAVFoundation`, `libswiftDataDetection` on Intel;
`libswiftSpatial` on M1). The entries that matter here:

| Library | Why it is there |
|---|---|
| `Contacts.framework` | contact resolution — the path the contact-batch patch changes |
| `/usr/lib/libsqlite3.dylib` | **the system SQLite**, confirming the earlier reading: `CSQLite` is linked only on Linux, and SQLCipher is not linked at all |
| `ScriptingBridge`, `AudioToolbox`, `ImageIO`, `LinkPresentation` | send and attachment paths, linked but not reached by read-only routes |
| `CryptoKit`, `Foundation`, `CoreFoundation`, `libSystem` | ordinary runtime |

This is a stronger result than expected. A binary whose entire load list is
OS-provided cannot be redirected by a dropped-in dylib in a project directory,
and `DYLD_*` is already excluded by the Phase C environment contract.

## E2 — The bridge helper cannot be found, and that is the intended state

`BridgeHelperLocator` searches, in order: beside the executable, `../lib`,
`$HOMEBREW_PREFIX/lib`, `/opt/homebrew/lib`, `/usr/local/lib`, and
`.build/release` / `.build/debug` **relative to the working directory**.

Two of those are hardcoded Homebrew prefixes that the Phase C environment
contract cannot suppress — dropping `HOMEBREW_PREFIX` removes only the
variable-driven entry. So the question is whether a stock-installed helper sits
in one of them and would be picked up by *our* build.

Checked on both hosts, read-only: `imsg-bridge-helper.dylib` is **absent** from
`/usr/local/lib` and `/opt/homebrew/lib` on both, and is **not produced by
`swift build`** — upstream's `Makefile` builds it separately with `clang`, and
Phase D deliberately did not.

So our products can locate no helper at all. That is the intended state for a
project that never launches or injects, and it is now a checked fact rather than
an assumption. It also means the cwd-relative entries in that search order,
which Phase C flagged as a reason the working directory is not cosmetic, have
nothing to find either.

## E3 — Signing reproduces the historical asymmetry exactly

| Host | Our v0.15.4 product | Historical record |
|---|---|---|
| Intel | `code object is not signed at all` | Intel release artifacts **unsigned** |
| M1 | ad-hoc, **linker-signed**, `Identifier=imsg` | M1 release **ad-hoc linker-signed, identifier imsg** |

The historical asymmetry recorded in `docs/release-comparison-record.md` was
never explained. It reproduces exactly in artifacts we built ourselves, from the
same source, months later, so it is a property of the platform and toolchain
rather than of those particular old builds.

This matters for the first-execution phase: a binary with no signature and a
binary with an ad-hoc signature have different code identities, and neither
shares the stock binary's identity.

## E4 — One observation this record does not explain

`LC_BUILD_VERSION` on the two products:

| Host | `minos` | `sdk` | `xcrun --show-sdk-version` |
|---|---|---|---|
| Intel | 14.0 | 15.5 | 15.5 |
| M1 | 14.0 | **14.0** | **27.0** |

Intel's recorded SDK matches the installed SDK. The M1's does not: the binary
records 14.0 while the toolchain reports 27.0. **Why is not established.**

It is recorded because the reason for collecting `LC_BUILD_VERSION` was to turn
"built against a beta SDK" from an inference into a fact, and the fact that came
back does not say what was expected. Asserting "the M1 artifact was built
against the beta SDK" on the strength of `xcrun` alone would now be exactly the
kind of single-observation inference this project published once already and had
to retract within the hour.

## E5 — IPC side effects, consolidated

From the pinned source, unchanged through 0.15.4 and already established in the
earlier audit:

- `invokeWithoutLaunching` refuses legacy IPC and an absent ready lock, and
  never calls `ensureRunning` / `ensureLaunched`.
- An **already-ready** bridge status probe uses `invokeV2`, which creates the
  inbox/outbox directories if needed, publishes a UUID request file, and reads
  and removes protocol files. **"Does not launch" is still not "zero writes."**
- 0.15.3 added a launch lock inside Messages' container, reachable only from the
  launching entry points, so the no-launch path does not touch it.
- `MessageStore` opens SQLite read-only; the web routes set `attachments:false`.

What none of this establishes is whether the OS itself writes — WAL, SHM,
journal, Spotlight, unified log — while the database is open read-only. That is
observable only by running.

## What remains, and why it needs its own phase

Everything below is knowable only by executing a product:

- `imsg rpc` behaviour on stdin EOF versus `SIGTERM`, and whether the client's
  close sequence matches what the binary expects.
- Process-group interaction with the Agent's `ExitTimeOut`.
- Whether `Bundle.module` finds the resource bundle from the real layout — the
  patch makes it searchable, but only a run proves it resolves.
- Whether the OS prompts for Contacts or Full Disk Access. A self-built binary
  has a different code identity from the stock one and **does not inherit its
  grants**, so this may require the owner to grant access again, at the desktop,
  by hand. Nothing here automates that.
- Any filesystem write the OS makes on the project's behalf.

**No product may be executed under this phase.** The first execution is its own
phase with its own authorization, a decision taken precisely because Phase C and
Phase D had referred to each other in a way that could have let it happen with
no approval point passed.
