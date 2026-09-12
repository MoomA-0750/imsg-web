# Phase F — the first execution of a built product

Status: **proposed, nothing executed.** This project has never run `imsg`.

Phase F exists because Phase C and Phase D referred to each other in a way that
could have let a first run happen with no approval point passed. It is that
approval point.

## What makes this different from every phase so far

A, B and E read. D wrote files. **F starts a process that opens Apple's
frameworks and, depending on how far it goes, the owner's message database.**

Two consequences that no earlier phase had:

- **The OS may put a dialog on the owner's desktop.** A self-built binary has a
  different code identity from the stock one and **does not inherit its grants**,
  so Contacts or Full Disk Access may be requested. Nothing here automates that,
  and a prompt stops the phase.
- **On the Intel host, Messages already has a bridge injected** by the owner's
  separate `imsg-claude` system, with a live `imsg` process of its own. An RPC
  status probe on a *ready* bridge does IPC — it creates and removes request and
  response files. That would be this project touching another system's live
  bridge.

## The ladder

Each rung answers something the previous one could not, and **no rung reads the
owner's messages**. Real data is step3 and is not authorized by this phase.

### F1 — `--version`, nothing else

The narrowest possible execution: no database, no Contacts, no bridge.

Answers: does the product run at all; do its linked libraries resolve; does the
ad-hoc signature (M1) or the absent signature (Intel) stop it; does a prompt
appear.

Run under the Phase C environment contract — the allow-listed `HOME`, `PATH`,
`TMPDIR`, `LANG`, `LC_ALL`, an explicit cwd containing no `.build`, and nothing
else. Bounded by a timeout. Process list and the private directory observed
before and after.

### F2 — `rpc` against a **synthetic** database

`RpcCommand` takes `--db`, defaulting to `~/Library/Messages/chat.db` only when
absent. Pointing it at a synthetic SQLite file exercises the protocol and the
lifecycle **without opening the owner's data**.

One `status` request, then stdin EOF. Answers:

- whether `Bundle.module` resolves the PhoneNumberKit bundle from the real
  layout — the patch makes it searchable, but only a run proves it resolves, and
  the failure mode is a `fatalError`, not a missing file;
- what the process does on EOF, and whether the client's close sequence matches;
- whether anything is written that Phase E could only predict.

The synthetic database is created by this project, in the private directory, and
contains no real content.

### F3 — the same, terminated by `SIGTERM`

Separately, because EOF and `SIGTERM` are different paths and the Agent's
shutdown uses the latter. Also observes process-group behaviour against the
`ExitTimeOut` the plist sets.

### Not in this phase

Opening the real `chat.db`. Any bridge or Messages interaction. Any contact
lookup against real handles. C06 timing. Those are step3.

## Which host first, and why it is not obvious

The instinct is Intel, because it is the one with the historical evidence. That
is the wrong order here.

Intel is the host where a foreign system keeps a live `imsg` and an injected
bridge. Even a `status` call on a ready bridge does IPC. **M1 goes first**, and
before F2 runs anywhere, a read-only check establishes whether a bridge ready
lock exists on each host — because "no bridge is ready" and "a bridge belonging
to someone else is ready" are very different starting conditions, and this
project has never checked which one it is in.

If a ready bridge is found on a host, F2 does not run there until the owner has
decided whether an IPC exchange with it is acceptable.

## Stop conditions

- Any dialog on the desktop.
- Any exit code, signal or output the plan did not anticipate.
- Any file appearing outside the private directory and the product's own tree.
- A ready bridge on a host where F2 was about to run, before that is decided.
- Any sign that the foreign `imsg` process or the owner's Messages state changed.

Uncertainty stops the phase. Nothing is cleaned up afterwards.

## What Phase F cannot establish

That the product reads real data correctly. That contact names resolve — with a
synthetic database there are no handles to resolve. That performance is
acceptable. That the stock and self-built binaries behave the same. Whether the
OS writes to the real database's WAL or journal, since the real database is
never opened.

It also cannot establish that no prompt will appear later: a grant race during a
real-data run is a different situation from a synthetic one.

## Review scope

- Is F1 genuinely the narrowest execution, or does `--version` already
  initialise something that reaches Contacts or the bridge? Check the pinned
  source rather than assuming.
- Does `--db` actually prevent the default path from being opened, on the
  code paths `rpc` takes?
- Can a synthetic SQLite file drive `status` far enough to prove the bundle
  resolves, or does that need a schema the fixture will not have?
- Does the ladder leave a rung where a prompt is likely but unanticipated?
- Is "M1 first" right, and does the ready-lock check belong before F1 rather
  than before F2?
- What does this plan not observe that it should — file descriptors, the unified
  log, the private directory's contents, the foreign process?

---

# Review dispositions

Two blockers, both in the plan's own claims rather than in the approach. Every
technical assertion below was re-verified against the pinned source before being
adopted.

## Blocker 1 — Phase C's environment contract unlocked the Contacts prompt

`ContactResolver.create` reaches `requestAccess` when three things hold:

```swift
if initialStatus == .notDetermined, accessPolicy == .requestIfNeeded, !isSSH {
```

- `.notDetermined` — a self-built binary has its own code identity and inherits
  no grant, so this is the expected state.
- `!isSSH` — `isSSH` is true only when `SSH_CONNECTION` or `SSH_CLIENT` is set.
  **The Phase C allow-list drops both.** So this condition is satisfied *because
  of the environment contract this project added.*
- `.requestIfNeeded` — set by `RpcCommand.startupContactsAccessPolicy` when
  **stdin is a TTY**.

Only the third is left standing between this plan and a permission dialog, and
the plan said "no Contacts" without naming it.

Phase C recorded that clearing the environment "is a choice to run in the
non-SSH branch", framed as a choice about which contact source is used. It is
also a choice to **remove the guard that was suppressing the permission
request**. Under the old inherited-environment behaviour `isSSH` was true and
`requestAccess` was unreachable; under the contract it is reachable.

**Adopted:** F2 and F3 assert `[ ! -t 0 ]` before running, and the runner feeds
stdin from a pipe. That is also what production does — a launchd Agent's stdin
is not a terminal — so the fidelity improves at the same time. The plan's "no
Contacts" becomes "Contacts are queried for authorization status only; no prompt
is reachable, *conditional on non-TTY stdin*".

## Blocker 2 — `status` always stats the Messages container, whatever `--db` says

`status` calls `bridgeSnapshot()`, which begins `guard isBridgeReady()`, whose
default is `IMsgBridgeClient.shared.isReady()` → `hasReadyLockFile()` → a
`fileExists` on `<container>/.imsg-bridge-ready`. `--db` changes only where the
database is read from; it does not keep the run away from Messages' container.

If that lock is present, `status` proceeds to `invokeWithoutLaunching`, which
writes a request file, polls, and reads and removes a response. On the Intel
host that lock plausibly belongs to the owner's separate system.

**Adopted.** The plan now says this plainly. The ready-lock check becomes
**three-valued — present, absent, or unreadable** — and "unreadable" is not
recorded as "absent". That distinction is the Phase A lesson restated: a probe
whose failure mode is known cannot have its negative result treated as evidence.
Inbox and outbox are recorded by **count and mtime only**; their contents are
never read, since a foreign system's request bodies could be in them.

`--db` itself does work as the plan assumed: `values.option("db") ?? MessageStore.defaultPath`
uses `??`, whose right operand is an autoclosure, so the default path is not
even evaluated when the option is present.

## Also adopted

**Contacts could be read silently.** If authorization is somehow already
`.authorized`, `status` reaches `ContactCatalog`'s `enumerateContacts` and loads
the owner's entire address book into memory. The plan promised no rung reads the
owner's data; contacts are the owner's data. `contacts.available: false` becomes
a **required** element of the predicted response, and `true` is a stop condition.

**The bundle claim was too strong.** `PhoneNumberNormalizer` is a stored
property of `ContactResolver`, constructed before `RPCServer` exists, so reaching
the stdin wait proves the bundle **directory** resolved — a missing directory is
a `fatalError`. But a present directory with unreadable metadata is caught inside
`populateTerritories` and **continues silently with empty territories**. With a
synthetic database no number is ever normalised, so that degradation is
invisible in F2 and would first appear in step3 as "names do not resolve". The
only evidence for the metadata itself remains the digest Phase D recorded.

**Predicted values, so deviation is detectable.** F1: `0.15.4` on stdout, empty
stderr, exit 0. F2: one response with `database.ready: true`, `database.path`
equal to the fixture's absolute path, `bridge.ready: false`, `contacts.available:
false`, then exit 0 on EOF. F3: no `SIGTERM` handler exists in the sources, so
default disposition and status 143. A `fatalError` shows as 132/133; a signature
rejection as 137.

**Observations the plan omitted:** `lsof` on the waiting process, as the most
direct evidence that neither `~/Library/Messages` nor the container is open;
`~/Library/Logs/DiagnosticReports/` before and after, since a crash writes an
`.ips` there containing argv and is the likeliest file to appear outside the
private directory; the unified log filtered to the TCC subsystem, because **Full
Disk Access never prompts — it is silently denied**, so the log is the only way
to see it from SSH; the fixture's `-wal`/`-shm` sidecars; a baseline of the Intel
foreign system, since "any sign the foreign process changed" had no measurement
defined; `umask 077` to match the Agent's `Umask 63`; and how the run is bounded
at all, since `timeout` is not on the allow-listed `PATH`.

**Order corrected.** "M1 first" was justified by the foreign bridge, which is an
F2 concern only — F1 never touches the launcher. F1 runs on **Intel first**,
because it is the stable OS and an anomaly there has one candidate cause rather
than two. F2 and F3 still run on M1 first, and on Intel only after the owner has
decided about the foreign bridge.

**Before F1:** `xattr -l` to confirm no quarantine attribute, and
`codesign --verify --verbose` on the M1 product. Both read-only.

**F3 narrowed** to imsg's own response to `SIGTERM`. `ExitTimeOut` governs
launchd's relationship with the Node server and is not observable here.

## The Phase E asymmetry now has an explanation

Phase E recorded that Intel's product is unsigned while the M1's is ad-hoc
linker-signed, reproducing a historical asymmetry, and called it "a property of
the platform and toolchain" without saying which.

It is the architecture. Apple Silicon will not execute unsigned native arm64
code, so the linker ad-hoc signs on arm64 and has no reason to on x86_64. This
is platform behaviour, not something verifiable from the pinned source, and it
carries a consequence worth recording: **the M1 product runs only while its
signature stays valid**, so any later strip, patch or one-byte edit turns it into
a `SIGKILL` rather than a diagnosable failure.

## The stop condition that cannot be watched

"Any dialog on the desktop" is not observable from an SSH session. The fix is to
stop relying on watching it:

1. F1 cannot reach the TCC path at all — structurally, not by policy.
2. F2 and F3 assert non-TTY stdin, which makes `requestAccess` unreachable.
3. `contacts.available: false` is required in the response.
4. "No response within the bound" is *defined* as a possible prompt, and the
   owner looks at the desktop before anything else runs.
5. The TCC subsystem log is checked after each rung.
6. After the phase, the owner checks Privacy settings for a new `imsg` entry.

Point 6 is the one that matters most: a permission entry is the only outcome
here that persists after everything else is cleaned up, and removing it is a
change to the owner's system that this project will not make.
