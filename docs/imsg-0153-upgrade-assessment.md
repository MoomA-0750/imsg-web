# imsg 0.15.1 → 0.15.3 assessment (2026-09-12)

The M1 host's stock imsg was upgraded to `0.15.3` on 2026-09-11, after every
recorded checkpoint and outside this work. This is the source-level assessment
of what that changes for the step2 audit. It is **source analysis only**: no
imsg was executed, no binary was built, and nothing on either Mac was changed,
downgraded or reinstalled.

Range: `646ea7a` (v0.15.1, the pinned audit commit) → `f2455d9` (v0.15.3).

## What changed

Ten commits, of which two are release chores and two are docs. Excluding
documentation and tests, eight files changed:

| File | Change |
|---|---|
| `Sources/IMsgCore/BridgeLaunchCoordinator.swift` | +86 — cross-process serialization of Messages launches via a lock file |
| `Sources/IMsgCore/LaunchReadinessTimeout.swift` | new, +32 — configurable launch-readiness timeout |
| `Sources/IMsgCore/MessagesLauncher.swift` | +27 — takes the coordinator with an explicit lock path, uses the resolved timeout, closes a readiness race, rewords one error |
| `Sources/IMsgHelper/IMsgInjected.m` | +187 — one owner per container for the injected bridge helper |
| `Makefile`, `Info.plist`, `Version.swift`, `version.env` | release plumbing |

The upstream intent is visible in the new file's own comment: reporting a slow
cold start as a failure causes a supervisor to relaunch, producing two injected
Messages instances competing for one bridge queue. Every functional change is
about **launching** being serialized, bounded and idempotent.

## Every audited file is byte-identical

The step2 source audit read nine files. All nine are unchanged between v0.15.1
and v0.15.3:

`RpcCommand.swift`, `RPCServer.swift`, `RPCServer+Handlers.swift`,
`RPCServer+StatusHandlers.swift`, `MessageStore.swift`, `ContactResolver.swift`,
`ContactCatalog.swift`, `IMsgBridgeClient.swift`, `AddressBookContacts.swift`.

So the audited conclusions carry over unchanged: `invokeWithoutLaunching` refuses
legacy IPC and an absent ready lock and never calls `ensureRunning`/
`ensureLaunched`; `MessageStore` opens SQLite read-only; the SSH AddressBook
fallback behaviour is the same; web requests still set `attachments:false`.

`invokeWithoutLaunching` appears in the diff only inside test files.

## The one change that needed checking, and why it is inert

`MessagesLauncher`'s **initializer** changed, and the audit's standing claim is
that initialization "resolves an existing helper path with `fileExists`; it does
not launch or inject". The initializer now also constructs a
`BridgeLaunchCoordinator` with a lock-file path **inside Messages.app's
container**:

```
(containerPath ?? NSHomeDirectory() + "/Library/Containers/com.apple.MobileSMS/Data")
  + "/.imsg-launch.lock"
```

If that file were created at construction, `RPCServer` — which initializes a
`MessagesLauncher` — would acquire a new filesystem write on the **no-launch**
path, inside Messages' own container. That would be a material regression for
this project.

It is not. `BridgeLaunchCoordinator.init` only stores the path. The directory
and lock file are created in `withLaunchLock`, which is reached only from
`run` / `runSynchronously`, and those are called only from `ensureRunning` and
`ensureLaunched` — the two launching entry points that `invokeWithoutLaunching`
never calls. The initializer change is inert for this project's call paths.

This does not weaken the existing qualification: **non-launching is still not
zero writes.** An already-ready bridge status probe continues to create and
remove IPC request/response files. 0.15.3 neither adds to nor removes that.

## A new environment variable the trusted launcher must handle

`IMSG_LAUNCH_READY_TIMEOUT` is read by `LaunchReadinessTimeout.resolve()` from
the process environment, with a 15 s default and a 600 s ceiling. It is read
only, never written.

It matters for Phase C anyway: the trusted launcher's environment is supposed to
be explicit and reviewed, and this is a newly inherited knob that can change
launch timing. It must be set deliberately or omitted deliberately, not
inherited by accident.

## The stored contact-batch patch still applies

The patch changes `ContactCatalog`, `ContactResolver`, `RPCServer+Handlers` and
two tests. None of those files changed. Verified directly against a detached
worktree at v0.15.3:

```
git apply --check experiments/contact-batch/imsg-0.15.1.patch   # applies cleanly
```

The patch is still named for 0.15.1. It should be re-pinned rather than
re-authored. Applicability is not a build, and not provenance.

## Reverting is unnecessary, and not locally possible

The upgrade does not invalidate the read-only audit, so there is no defect to
revert. Separately, a local downgrade is not available: the M1 host's Cellar
retains **only** `0.15.3`; the `0.15.1` tree is gone, as Homebrew removes the
superseded version on upgrade. Restoring it would mean a network reinstall of an
older formula, which is a change to stock imsg and is not in scope.

The recommendation is to **re-pin the audit to 0.15.3** rather than chase 0.15.1.

## What this does not establish

That the binary now installed on the M1 host was built from this source. Source
analysis is not provenance: the installed image is a Homebrew bottle, its digest
has no prior record here, and binding it to reviewed source remains Phase B.

Also unestablished: the behaviour of the `IMsgInjected.m` changes, which are
substantial. They are not on this project's no-launch path, but they do bear on
any host where a bridge helper is already injected by another system — which is
the situation on the Intel host. Version skew between an injected helper and a
CLI is a Phase C/E question, not answered here.

Behavioural equivalence between 0.15.1 and 0.15.3 has **not** been demonstrated.
Demonstrating it would require executing imsg, which the admission chain still
gates.

---

# Correction: how the "byte-identical" claim was originally checked

The claim above — that all nine audited files are unchanged between v0.15.1 and
v0.15.3 — **is correct, but the check that produced it was not.** Two defects,
found while extending this assessment to 0.15.4:

1. **Four of the nine paths did not exist.** The check used
   `Sources/imsg/RpcCommand.swift`, `Sources/IMsgCore/RPCServer.swift`,
   `Sources/IMsgCore/RPCServer+Handlers.swift` and
   `Sources/IMsgCore/RPCServer+StatusHandlers.swift`. The real paths are
   `Sources/imsg/Commands/RpcCommand.swift` and `Sources/imsg/RPCServer*.swift`.
   `git diff --name-only <range> -- <nonexistent path>` prints nothing, which the
   check read as "unchanged". Four of the nine results were vacuous.
2. **The loop did not iterate.** The file list was held in a plain shell
   variable and iterated in `zsh`, which does not word-split unquoted parameters
   by default, so the entire list was treated as a single path. Every result was
   the same vacuous "unchanged".

Re-checked with the correct paths and an array:

- **v0.15.1 → v0.15.3: all nine genuinely unchanged.** The conclusion stands.
- **v0.15.1 → v0.15.4: `Sources/imsg/RPCServer.swift` changed.** The broken
  check reported it as unchanged. The defect was not hypothetical.

A verification that cannot fail is not a verification. Both defects are the same
species as the ones this project has been catching in the Mac scripts, and they
occurred in the tooling used to check the source rather than in the source.

# Extension to v0.15.4

`v0.15.4` (`e2f5046`) is the latest release; `0.15.5` is open but unreleased.

## The one audited file that changed

`Sources/imsg/RPCServer.swift` gains a `stageAudioAttachment` stored property
with a default of `AudioMessagePreparer.prepare`, assigned in both initializers.
It is additive and follows the pattern the audit already recorded: **RPCServer
stores action closures rather than invoking them.** It is on the send path, for
inline-playable audio messages, and no read-only route this project uses reaches
it. The audit's standing conclusions are unaffected; this closure simply joins
the list of stored-but-uninvoked actions.

The other 0.15.4 changes are `AudioMessagePreparer` (new), `MessageSender`,
`BridgeAttachmentCommand`, `RPCServer+BridgeMessageHandlers`, and release
plumbing — all send/attachment path.

## Build inputs at v0.15.4

| | SHA256 |
|---|---|
| `Package.swift` | `0785085f66d192c871b9cd145a0a65b0aa2765cbce6ee576bd70aa609d3442d4` |
| `Package.resolved` | `61a6573a5e5bee68be9cc8c562e55ca39662033877ec611176734b5af59056c8` |

Pins: `commander` 0.2.4, `csqlite` 3.53.3, `phonenumberkit` 5.0.9,
`sqlite.swift` 0.16.0. The lock moved from 0.15.3 only by the PhoneNumberKit
bump (5.0.8 → 5.0.9, "refresh phone metadata").

**This lock is complete**, unlike 0.14.2's. `CSQLite` is a declared direct
dependency from 0.15.x onward, and `Package.swift` links it only
`.when(platforms: [.linux])` — which is why a macOS build of 0.14.2 succeeded
despite the pin being absent from that version's committed lock, and why
resolution adds it anyway: SwiftPM resolves the whole graph regardless of
platform conditions.

The stored 0.15.1 patch **applies cleanly to v0.15.4**, verified against a
detached worktree at `e2f5046`.

## Platform feasibility on both hosts

Both v0.14.2 and v0.15.4 declare `swift-tools-version: 6.0` and
`platforms: [.macOS(.v14)]`. Both hosts satisfy the deployment target. Whether
each host has a Swift 6.0 toolchain is **not established** and becomes a pass 2
item: the Intel host demonstrably built this package before, but its toolchain
version was never recorded, and the two hosts are now on very different macOS
releases.

Swift is not installed on this workstation, so no dependency resolution can be
performed here. Any resolution happens on a Mac, during Phase D.
