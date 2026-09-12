# Step2 Phase A — read-only Mac inventory command plan (v2)

Status: **proposed, not executed.** No Mac has been contacted. This file is the
exact, complete plan for Phase A, written so it can be reviewed and rejected
before any connection.

v2 supersedes v1 after the F1 critical review. v1 had three blockers: a command
that leaked the value it claimed to hide, undefined placeholder substitution
that would have produced false "not found" records, and `git status`, which
writes `.git/index` and can spawn a resident `fsmonitor--daemon`. The
disposition table for every finding is at the end of this file.

Scope: identify what exists on both retained Mac environments and compare each
artifact against a recorded digest. Phase A answers "what is there", not "is it
trustworthy" (Phase B) and not "is it safe to run" (Phase C).

**Open owner decision before execution:** see "Where raw output goes" below.

## Hard boundaries for this phase

- **`imsg` is never invoked**, in any form, including `--version` and `--help`.
- **The dedicated Node executables are never invoked**, including `--version`.
  Identity comes from digest, `file`, `codesign` and `otool`. Executing the M1
  runtime would run a binary the owner granted Full Disk Access to, which is an
  admission decision belonging to Phase C. Allowing it is a deliberate override.
- **No `sudo`, ever.** Anything needing it is reported as "not established".
- **No writes to project state**: no create, move, delete, chmod, chown, no
  `launchctl` load/unload/bootout/bootstrap, no `tailscale serve` mutation, no
  signals, no `killall`, no stale lock or socket cleanup.
- **No command that writes to a git repository.** `git status` is used only in
  its documented non-locking form, and only after checking for a pre-existing
  `index.lock`. See A6.
- **The running `watcher.py` is never stopped, signalled, edited or restarted.**
  It is observed only as: does a process exist, and what is the digest of the
  script file. Its contents and its full argv are never captured.
- **No broad filesystem scans.** Every path is the known base directory, a known
  temporary directory, or a depth-bounded search inside one. No `find /`, no
  `mdfind`, no Spotlight, no `locate`.
- **The Messages database and TCC database are not read, stated, or listed.**
- **No permission is added, removed or moved.** If any prompt appears on the Mac
  desktop, Phase A stops for that host.

## What "read-only" does not mean

No intentional change is made, but the following happen anyway and must never be
described as "zero writes":

- SSH login is recorded by the OS (`utmp`/`wtmp`, unified log, possibly
  `lastlog`). Connecting is itself an observable event.
- `codesign` emits system log entries and may consult system caches.
- Hashing a file reads it fully and **updates its atime**, which can affect any
  later judgement about how recently a temporary directory was used.
- `otool`, `lipo` and `git` on macOS are `xcrun` shims. Invoking one when the
  Command Line Tools are absent can raise a GUI install dialog on the console
  user's desktop — an event this plan's own abort conditions treat as a stop.
  A6/A3/A4/A5 are therefore gated on the `xcode-select -p` check in A1.

## Execution mechanism

v1 issued 40+ separate `ssh host '<cmd>'` invocations per host. That meant 40+
logins, 40+ shell-init executions, and `$BASE` being expanded by the **remote**
login shell, where it is undefined. It also exposed the plan to zsh's `nomatch`,
which aborts a whole command on an unmatched glob — silently, once stderr is
discarded.

v2 instead sends **one script per host per pass**:

```sh
ssh -o BatchMode=yes -o RequestTTY=no -o ForwardAgent=no \
    -o ClearAllForwardings=yes <HOST> /bin/sh -s < phaseA-pass1-<host>.sh
```

Consequences, all deliberate:

- The interpreter is `/bin/sh`, not the login zsh. No `nomatch` aborts.
- Paths are substituted into the script **locally, as literal absolute paths**,
  before sending. Nothing depends on remote environment variables.
- The script is the reviewable artifact. It is committed to the Vault note with
  its literal paths, and reviewed as text before it is ever sent.
- One login per pass instead of forty.

Substitution rule: each substituted path must be absolute and must contain no
`$`, backtick, `"`, `'`, `;`, newline or `\`. A local check asserts this and
refuses to build the script otherwise. Every script begins with `set -u` and
prints `== <section>` markers so output is attributable.

Two passes are required, because some paths are discovered rather than known:

- **Pass 1 — discovery.** Host context, tool availability, directory trees,
  process/Agent/Serve state. Produces the list of concrete artifact paths.
- **Pass 2 — per-artifact detail.** Digest, mode, arch, signature, linked
  libraries for each path Pass 1 actually found. Built from Pass 1's output,
  never from guesses.

## Where raw output goes — **owner decision required**

Raw Phase A output contains the hostnames, user names, absolute paths, a full
process list, loaded LaunchAgent names, tailnet names and the Homebrew wrapper
text. `AGENTS.md` forbids logging private machine inventory. v1 only promised
not to put it in this repository, which was incomplete: if an agent runs these
commands, the raw output also enters the agent's session transcript, and the
command lines enter this workstation's shell history.

The plan is therefore written so that **raw output never passes through the
agent**:

```sh
ssh ... <HOST> /bin/sh -s < phaseA-pass1-<host>.sh \
  > "<vault-dir>/phaseA-pass1-<host>.log" 2>&1
```

A local extraction step then reads that log and emits only derived, public-safe
lines: digest-vs-expected verdicts, counts, and gate outcomes. Digests already
published in `docs/` are safe to surface; hostnames, paths and process lists are
not.

The owner still needs to choose:

1. **Agent-run, redirected** (proposed): the agent issues the ssh commands but
   never sees raw output, only the derived verdicts. Command lines contain the
   ssh alias only.
2. **Owner-run**: the owner runs the two scripts and the agent only receives the
   derived comparison. Strongest confidentiality; slowest.
3. **Agent-run, unredirected**: raw inventory enters the transcript. Not
   recommended, and not reversible.

Nothing is executed until this is answered.

## A0 — local preflight (this workstation, no Mac contact)

### A0.1 — ssh configuration, without connecting

```sh
ssh -G <IM>
ssh -G <MAC>
```

`ssh -G` resolves the effective configuration and **makes no connection**.
Confirms the destination, and confirms that `RemoteCommand`, `ForwardAgent`,
`PermitLocalCommand` and `RequestTTY` are not set in a way that would change
what the scripts do.

Note on host keys: `BatchMode=yes` **rejects** an unknown host key rather than
prompting, and does not append to `known_hosts`. v1 stated the opposite. If a
key is not already trusted, the connection simply fails; the fingerprint is then
compared against the Vault record and registered deliberately, never with
`StrictHostKeyChecking=accept-new`.

### A0.2 — expected-value table

Phase A compares rather than discovers. Every value below is already published
in this repository.

| Artifact | SHA256 | Recorded properties |
|---|---|---|
| Node 24.20.0 Darwin x64 archive | `9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4` | official checksum list |
| Node 24.20.0 Darwin arm64 archive | `40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8` | official checksum list |
| Intel `Package.resolved` | `119d9373e83738fb78819106065d119fcb53b262a77a97c1c087bf01aba273e9` | shared by baseline and candidate |
| M1 `Package.resolved` | `be55852d84140bb12cbf4c58bb67f8260337878837e80d6ddeef41f259a3ae00` | shared by baseline and candidate |
| Intel 0.14.2 **debug** candidate | `f1433d9e4e6b6da11157355c9621f8ed0a8bcbe079f2e8c3c620248d4dd38c22` | x86_64, ad-hoc, no TeamIdentifier |
| M1 0.15.1 **debug** candidate | `cad81d4b181332dfb244c07ef8e87931210850cba6cb13fa30c6afc690ae9bef` | arm64, ad-hoc, no TeamIdentifier |
| Intel **release** A / B | `806375b93c30618cb68864aaa65791c5431ba981b0ab6345cb8bd1457b91a1bb` / `956e7bf2afe449ea9d6778f503e9768efacb58bf6e2e0873c44b36ff3a9f5498` | x86_64, **unsigned** |
| M1 **release** A / B | `4e2f4083af27fef9171a70b77693d7e982a6c8eef624cfe79f3608847a0c40f6` / `71fc75a18269dd293cefc2094f2d445fb7d0a709d3d18681966c0219e9df0699` | arm64, ad-hoc linker-signed, identifier `imsg`, no TeamIdentifier |
| App release `a342425` archive | `4579a40b2ad9cfd91bce29059b33aef4d5861bae59564663b9c26bdd59990816` | historical only, never a measurement artifact |
| App candidate archive (`9b64d36` line) | `9b6c8a36d6d677e15c965edf3790e3c853c58842228c9960a64d6004c60b8432` | historical |
| Stored patch 0.14.2 | `d32cad5e1b99c34f8ce981be38cfc28889ec4f0c4f619dd0e0e36018500f8700` | local, already re-verified |
| Stored patch 0.15.1 | `6715e27a40fa5d47a0e9245a5f6f197fc59cb5754d95c0e7c9d6870c9f187b65` | local, already re-verified |

Two corrections v1 got wrong and that would have generated false findings:

- **Signature expectations differ per artifact class.** "ad-hoc, no
  TeamIdentifier" is the *debug* expectation. Intel **release** artifacts are
  unsigned; M1 **release** artifacts are ad-hoc linker-signed with identifier
  `imsg`. Applying the debug expectation to a release binary would report a
  divergence that is actually the recorded state.
- **A/B ordering is recorded as baseline/candidate in that order, but the
  mapping is re-derived in Phase B, not assumed here.** Phase A records which
  digest was found at which path; it does not label one "the candidate".

Verdicts are **three-valued**: `matched`, `diverged`, `no prior record`.
`no prior record` is *not* an abort condition — it is recorded and handed to
Phase B. v1's two-valued comparison would have aborted on every baseline binary.

A recorded digest that matches proves the bytes are unchanged since that record.
It does **not** prove the bytes were built from reviewed source. That binding is
Phase B and is not claimed here. Archive checksum matching means the bytes equal
a checksum list fetched over HTTPS; it is not release-signature verification.

## Pass 1 — discovery

### A1 — host context and tool availability

```sh
id -un; id -u; hostname -s
sw_vers; uname -m; uname -r
echo "SSH_CONNECTION present: ${SSH_CONNECTION+yes}"
echo "shell: $0"
xcode-select -p; echo "xcode-select exit: $?"
test -d "<BASE>" && echo "base-ok" || echo "base-missing"
stat -f "%Sp %Su:%Sg %N" "<BASE>"
```

`${SSH_CONNECTION+yes}` prints `yes` when the variable is set and **nothing**
when it is not — it never expands to the value. v1 used `${SSH_CONNECTION:-no}`,
which expands to the variable's contents, i.e. it would have written both
machines' addresses and ports into the record while claiming not to.

Every Phase A observation is taken in an **SSH** context. Nothing here may later
be presented as representing a LaunchAgent context, and SSH variables are never
fabricated or cleared to change behaviour.

`xcode-select -p` reports the selected developer directory without requesting an
install. **Pass 1 records this result and does not branch on it**, because Pass 1
contains no `xcrun` shim at all — no `otool`, `lipo`, `git` or `swift`. The gate
is *consumed* when Pass 2 is generated: a non-zero exit there means those tools
are unavailable, their sections are omitted from the generated script, and the
corresponding rows are recorded as "not established" rather than risking a
desktop install dialog.

The script also sets `PATH=/usr/bin:/bin:/usr/sbin:/sbin` explicitly. `sshd`
gives a non-interactive shell its own default `PATH` and sources no login
profile, so leaving it implicit would make the inventory depend on remote
environment — the same failure class as the placeholder problem. One consequence
must be read correctly: **Homebrew's prefix is not on that `PATH`, so
`command -v imsg` is expected to fail on Intel.** A4 therefore probes absolute
paths, and a `command -v` miss is a fact about `PATH`, never evidence that
`imsg` is absent.

Abort for that host if: the user or hostname is not expected; the architecture
contradicts the record; `base-missing`; or the base directory's mode is not
`0700` or its owner is not the SSH user.

### A2 — base directory shape

```sh
ls -la "<BASE>"
ls -le "<BASE>"
find "<BASE>" -maxdepth 4 -print
find "<BASE>" -maxdepth 4 -type l -exec ls -l {} +
find "<BASE>" -maxdepth 4 -type f -perm -100 -print
find "<BASE>" -maxdepth 4 -type f -name "*.dylib" -print
find "<BASE>" -maxdepth 1 -name "*.plist" -print
find "<BASE>" -maxdepth 4 -name "node" -type f -print
find "<BASE>" -maxdepth 1 -type d -name releases -print
find "<BASE>/releases" -mindepth 1 -maxdepth 1 -type d -print
```

No globs are passed to the shell and **no `2>/dev/null` anywhere**: stderr is
part of the record, because "expected-readable path returns permission denied"
is an abort condition and v1 discarded exactly the evidence needed to detect it.

`-perm -100` is used rather than `-perm -u+x` to avoid any ambiguity in BSD
`find`'s symbolic-mode handling. `-type f` is required on the dylib and
executable searches so symlinks are enumerated once, in the dedicated `-type l`
pass, and not hashed twice under two names.

Symlink rule: a link whose target resolves **outside** `<BASE>` or `<TMPD>` is
recorded as a link with its target path, and its target is **not** hashed. The
single exception is the Homebrew `bin` entry in A4, which is expected to point
into the Cellar and is followed deliberately.

### A3 — process, Agent and Serve state

```sh
ps -axo pid,ppid,user,etime,comm
launchctl list
launchctl print "gui/$(id -u)"; echo "launchctl print exit: $?"
ls -la "$HOME/Library/LaunchAgents"
```

`launchctl print gui/<uid>` is added because an SSH session sits in the
`user/<uid>` context, and whether `launchctl list` enumerates `gui/<uid>` agents
from there is macOS-version dependent and unverified. If the domain is not
reachable, the non-zero exit is recorded as "not established" rather than read
as "no agents". Output is verbose and includes unrelated third-party agents, so
it goes to the Vault log only.

Its `environment = { ... }` block is **filtered out before anything is written**.
If the owner ever used `launchctl setenv` — plausibly for the watcher's AI-reply
branch — that block would carry the value verbatim into the raw log, which
`AGENTS.md` forbids. The section exists for the loaded-service list, not the
environment, so dropping the block costs nothing this phase needs. The filter is
read-only and the withheld block is marked in place rather than silently
removed.

Serve state, read-only, only if the CLI already exists:

```sh
command -v tailscale || ls /Applications/Tailscale.app/Contents/MacOS/Tailscale
<resolved-tailscale> serve status
```

`serve status` is a query and changes no configuration. The expected result is
the previously recorded empty configuration. Anything else stops Phase A and is
reported, because it would mean something is exposed that the records do not
describe.

Intel only — watcher observation, **bounded fields**:

```sh
ps -axo pid=,ppid=,args= | awk '/watcher\.py/ { print $1, $2, $3, $4 }'
```

This prints pid, ppid, interpreter and script path — and nothing else. The full
argv is never captured, because the running watcher contains an AI-reply branch
and its argv or environment may carry credentials. `comm` alone is useless here:
a Python script's `comm` is the interpreter, so `watcher` would never match.
`ppid` distinguishes launchd-managed from session-spawned. Nothing further
(`lsof`, environment) is collected. The script file is hashed in Pass 2; its
contents are never printed.

A PID, a process name and a `launchctl list` row are **context, not identity**.
No cleanup, no signal, and no "nothing is running" conclusion is drawn from a
single instant of `ps`. `ps` is captured again at the end of Pass 2 and the two
are diffed, which is also the concrete detector for the "any command appears to
have modified state" abort condition.

### A4 — imsg path resolution (Intel wrapper)

```sh
command -v imsg; echo "command -v exit: $?"
type -a imsg
ls -l "<path-from-command-v>"
stat -f "%N -> %Y" "<path-from-command-v>"
file -b "<path-from-command-v>"
```

`stat -f "%N -> %Y"` replaces v1's `readlink -f`, which only exists on macOS
12.3+ and would have failed silently under `|| true` on an older Intel iMac.
`%Y` prints the link target; links are followed one level at a time and each
level recorded.

The Homebrew-visible path was previously a shell wrapper that `exec`s a
versioned `libexec` image. The wrapper text is read **only if `file -b` reports
a text file** — if a `brew upgrade` has replaced it with a Mach-O, dumping 4 KB
of binary into the record is avoided:

```sh
head -c 4096 "<wrapper-path>"        # only when file -b says text
shasum -a 256 "<wrapper-path>"
stat -f "%Sp %Su:%Sg %z %N" "<wrapper-path>"
```

The wrapper text is recorded in the Vault note only, and is used solely to
discover the `libexec` target, which is then treated as the real image in
Pass 2. The wrapper path alone is never written into any manifest as if it were
the executable.

### A5 — locating the unrecorded M1 build tree

The M1 baseline/candidate build tree's path was not preserved, so finding it is
itself an inventory item. **On M1 this section runs before A6**, because A6's
`<TMPD>` is its output.

```sh
ls -la /private/tmp
find /private/tmp -maxdepth 4 -name "Package.resolved" -print
find /private/tmp -maxdepth 4 -name "Package.swift" -print
find /private/tmp -maxdepth 4 -type d -name ".build" -print
```

Depth is 4, not v1's 2. The comparable Linux audit tree places
`Package.resolved` three levels below `/tmp`, so depth 2 would have reported
"not found" for a directory that exists. macOS canonicalises `/tmp` to
`/private/tmp`; a previous live attempt failed on exactly this, so all recorded
paths use the canonical form.

`EACCES` on other users' `0700` directories under `/private/tmp` is **normal and
explicitly excluded** from the permission-denied abort condition. Only a denial
on a path this project is expected to own counts.

If the tree is not found, that is recorded as "not found". It is **not**
concluded that it was deleted, and nothing is deleted in response.

## Pass 2 — per-artifact detail

Built from the concrete paths Pass 1 found. For each artifact:

```sh
shasum -a 256 "<path>"
stat -f "%Sp %Su:%Sg %z %Sm %N" "<path>"
file -b "<path>"
xattr -l "<path>"
codesign -dvvv "<path>" 2>&1; echo "codesign exit: $?"
codesign -d --entitlements - "<path>" 2>&1
```

`codesign`, `file`, `xattr`, `stat` and `shasum` are base-OS tools and are always
available. The following run **only if A1 reported Command Line Tools present**:

```sh
lipo -archs "<path>"
otool -L "<path>"
otool -l "<path>" | grep -A2 LC_RPATH
```

`codesign` output is kept verbatim including its exit status, because "unsigned"
and "codesign failed" are different findings and v1's `2>&1` without an exit
check conflated them.

`otool -L`/`-l` report what the image **declares**. They do not report what a
future process would load: `DYLD_*` overrides, rpath search order and the bridge
helper's own resolution can all change it. Actual load closure is Phase C/E.

### A6 — source and build inputs

For each source tree found in Pass 1 (`<TMPD>` on M1 comes from A5):

```sh
shasum -a 256 "<tree>/Package.resolved"
shasum -a 256 "<tree>/Package.swift"
ls -la "<tree>/.git/index.lock"; echo "index.lock check exit: $?"
git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false \
    -C "<tree>" rev-parse HEAD
git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false \
    -C "<tree>" status --porcelain > "<tree-status-tmp-in-vault-log>"
```

v1 called `git status --porcelain` read-only. It is not:

- `git status` opportunistically refreshes stat information and **rewrites
  `.git/index`** via `.git/index.lock`. If interrupted, it leaves behind exactly
  the kind of stale lock this project forbids removing automatically.
- With `core.fsmonitor` enabled it **spawns a resident `fsmonitor--daemon`**
  that outlives the session.
- v1 piped it to `head -50`, so `SIGPIPE` could terminate git mid-write.

`--no-optional-locks` is git's documented instruction to avoid taking the index
lock; the two `-c` overrides are applied per-invocation and change no stored
configuration. The `head` pipe is removed; output is redirected whole and
truncated during local extraction instead. A pre-existing `index.lock` aborts
that tree — it is reported, never removed.

`rev-parse HEAD` is read-only and unproblematic.

A clean tree at a pinned commit is **not** evidence that it produced any
particular binary. That is Phase B.

### A7 — retained application releases

For each release directory enumerated in A2:

```sh
find "<release-dir>" -maxdepth 6 -type f -print | wc -l
find "<release-dir>" -maxdepth 6 -type f -name "*.tar*" -print
shasum -a 256 "<each-archive-found>"
```

v1 used `find ... -exec sh -c "echo \"== {}\"; find {} -type f | wc -l" \;`.
That was wrong three ways: BSD `find` substitutes `{}` inside the string, so a
base path containing a space (as `Library/Application Support` does) is split
into two arguments and the count silently becomes zero or wrong; a directory
name containing `;` or `$(` would be executed by `sh -c`; and the inner `find`
had no depth bound, contradicting this plan's own "every path is depth-bounded"
claim. v2 enumerates directories first and runs one bounded command per
directory.

Historical releases are positively identified **by archive digest** against the
A0 table, not by directory name — a mutable path is not an identity. Nothing in
`releases/` is deleted, moved or overwritten.

## A8 — close-out

No cleanup. Nothing deleted. Phase A ends by writing:

1. Per-host inventory tables into the Vault note: resolved absolute paths,
   digests, ownership/mode, architecture, signature summary, linked libraries,
   and each artifact's `matched` / `diverged` / `no prior record` verdict.
2. A public-safe summary into `docs/` and `STATUS.md`: which artifacts were
   found, which digests matched published values, which diverged, and what
   remains unestablished.
3. A separate list of deletion **candidates** with reasons, presented to the
   owner as a proposal. Nothing on it is acted on in this phase.

## Abort conditions

Phase A stops for the affected host, and the owner is told, if:

- Any permission prompt appears on the Mac desktop.
- A path this project is expected to own returns permission denied. (`EACCES` on
  another user's directory under `/private/tmp` is excluded.)
- `<BASE>` is missing, is not mode `0700`, or is not owned by the SSH user.
- A digest diverges from a published value in a way no known rebuild explains.
  (`no prior record` is **not** an abort; it is recorded for Phase B.)
- Serve, a LaunchAgent, or a listening process is found that the records do not
  describe.
- A pre-existing `.git/index.lock` is found in a source tree.
- The start/end `ps` diff, or the `xcode-select` check, indicates a process was
  spawned or state was modified.
- Ownership or current use of a retained artifact is uncertain.
- **A log does not end with the `== phase-a pass1 end` marker.** Because the
  script is fed to `/bin/sh -s` on stdin, any command that reads stdin would
  consume the rest of the script, and the run would end with exit 0 and a
  truncated log that looks complete. `set -u` aborting mid-script produces the
  same shape. The marker is the only reliable completeness check, and its
  absence is treated as failure, never as "that section found nothing".

Uncertainty is preserved as failure and the state is left exactly as found.

## What Phase A cannot conclude

Completing every command above does **not** establish source-to-binary
provenance, a safe launch environment, import/native/helper closure, absence of
filesystem or SQLite writes at run time, Contacts-source equivalence between SSH
and LaunchAgent contexts, real-data parity, C06 performance, or any approval to
execute `imsg`. Those are Phases B through E and step3, in that order.

## F1 review dispositions

Independent critical review of v1, before any Mac contact. Fifteen findings;
fifteen adopted, none rejected or deferred. Findings 1, 6 and 10 were
independently reproduced locally before adoption — a review is not a test.

| # | Finding | Disposition |
|---|---|---|
| 1 | `${SSH_CONNECTION:-no}` expands to the variable's value, leaking both machines' addresses and ports while the text claimed it recorded only presence | **Adopt.** Reproduced locally. Replaced with `${SSH_CONNECTION+yes}` |
| 2 | `$BASE`/`$TMPD` inside single quotes expand in the *remote* shell, where they are undefined; empty expansion turns real directories into "not found", feeding false deletion candidates | **Adopt.** Replaced with locally substituted literal absolute paths, sent as one `/bin/sh -s` script per pass, with a character-safety check on every substituted path |
| 3 | `git status` writes `.git/index`, can leave a stale `index.lock`, and can spawn a resident `fsmonitor--daemon`; the `head` pipe could `SIGPIPE` it mid-write | **Adopt.** `--no-optional-locks` plus per-invocation `core.fsmonitor=false`/`core.untrackedCache=false`; `head` pipe removed; pre-existing `index.lock` aborts that tree |
| 4 | `otool`/`lipo`/`git` are `xcrun` shims that can raise a GUI CLT install dialog — the plan could trigger its own abort condition | **Adopt.** `xcode-select -p` gate in A1; those sections skipped and recorded "not established" if absent |
| 5 | `find -exec sh -c "... {} ..."` breaks on the space in `Application Support`, injects a path into `sh -c`, and its inner `find` was unbounded | **Adopt.** Replaced with enumerate-then-count, depth-bounded, no `sh -c` |
| 6 | A0 omitted four release digests, two app archive digests, and the fact that Intel release artifacts are unsigned while M1 release artifacts are ad-hoc linker-signed — guaranteeing false "diverged" findings | **Adopt.** Verified all six values exist in `docs/`. A0 table extended; per-class signature expectations stated; verdict made three-valued |
| 7 | zsh `nomatch` aborts a whole command on an unmatched glob, and `2>/dev/null` hides it, so "no LaunchAgents" could be an artifact of the glob | **Adopt.** Globs replaced with `find`; all `2>/dev/null` removed; `/private/tmp` `EACCES` explicitly excluded from the abort condition |
| 8 | `comm` cannot identify a Python script, and identifying it via `args` risks capturing credentials from the AI-reply branch | **Adopt.** Bounded `awk` projection of exactly four fields; full argv never captured |
| 9 | `launchctl list` from an SSH session may not enumerate `gui/<uid>` agents | **Adopt.** `launchctl print gui/<uid>` added; unreachable domain recorded as "not established", never as "no agents" |
| 10 | `-maxdepth 2` is too shallow for `Package.resolved`; and on M1, A6 depends on A5's output but ran first | **Adopt.** Reproduced locally (the comparable tree is at depth 3). Depth raised to 4; A5 ordered before A6 on M1 |
| 11 | `readlink -f` needs macOS 12.3+ and `\|\| true` hid its failure | **Adopt.** Replaced with `stat -f "%N -> %Y"`, one level at a time; `\|\| true` removed |
| 12 | Raw output also reaches the agent transcript and local shell history, not just the Vault | **Adopt as an owner decision.** Plan restructured to redirect raw output straight to a Vault-side file with only derived verdicts surfaced; the choice of execution model is put to the owner and blocks execution |
| 13 | `BatchMode=yes` rejects unknown host keys rather than appending them, so v1's `known_hosts` note was wrong; no check that the aliases carry no `RemoteCommand`/forwarding | **Adopt.** Corrected; `ssh -G` preflight added; forwarding and TTY explicitly disabled at call time |
| 14 | Missing rules: mode/owner mismatch not an abort; symlink targets outside the tree still hashed; `head -c 4096` on a binary; `-perm -u+x` ambiguity; atime not mentioned | **Adopt.** All five added |
| 15 | "archive match ⇒ authentic download" overstates an HTTPS checksum comparison; "appears to have modified state" had no detector | **Adopt.** Wording corrected; detector specified as start/end `ps` diff plus the `index.lock` and `xcode-select` checks |

The review found **no path that invokes `imsg`, Messages.app or the bridge
helper**, no SIP/TCC or permission change, no signal to the watcher, no Serve
mutation and no stale lock removal, in either version.

## F1 focused re-review dispositions (the executable artifact)

`AGENTS.md` requires a focused re-review after adopted fixes, so the actual
shell template and its generator were reviewed, not just the prose. No
destructive blocker: the reviewer enumerated every command in the template and
found no write, signal, `sudo`, `launchctl` mutation, Serve mutation, discarded
stderr, shell glob, `-exec sh -c`, `imsg`/`node` invocation or temporary file.
Seven findings, all adopted.

| # | Finding | Disposition |
|---|---|---|
| 1 | `command -v imsg` depends on the remote `PATH`; `sshd`'s default excludes Homebrew's prefix, so Intel would have recorded "imsg not on PATH" and Pass 2 would have had no wrapper to resolve | **Adopt.** Explicit `PATH` declared; A4 rewritten to probe `/usr/local/bin/imsg` and `/opt/homebrew/bin/imsg` as the real discovery mechanism |
| 2 | `file -b` does not follow symlinks, so the `*text*` gate would be false for Homebrew's link and the wrapper body would never be read — while `shasum` read through the link, mixing link and target in one record | **Adopt.** `file -bL`, `stat -L -f`, `ls -lL` added, with the link itself still recorded separately |
| 3 | `launchctl print gui/<uid>` emits an `environment` block that would carry any `launchctl setenv` value, including a watcher credential, into the raw log | **Adopt.** Block filtered before writing and marked as withheld. Presented as an owner decision by the reviewer; the safer option is taken by default because `AGENTS.md` forbids logging owner keys, and re-running unfiltered remains possible if the owner wants it |
| 4 | Generator guards were bypassable: `$(...)` was not command position, `>>` and `&>` evaded the redirect check, indirect execution (`sh`, `eval`, `xargs`, …) was unlisted, `launchctl`/`serve` used deny-lists, and `find` roots were unchecked | **Adopt.** Substitutions are now audited recursively; append/combined redirects matched explicitly; indirect-execution commands added; `launchctl` and `serve` inverted to allow-lists (`list`/`print`, `status`); `find` roots restricted and `-delete`/`-ok`/`-execdir` rejected; `-exec` allowed only with read-only commands. Sixteen refusals are now covered by `scripts/gen-phase-a.test.mjs`, which also asserts the unmodified template still generates |
| 5 | Three `$?` echoes reported the wrong command: two `find`s sharing one echo (twice), and a pipeline reporting `awk` rather than `ps` | **Adopt.** Each `find` got its own echo; the pipeline echo is relabelled to say which element's status it is |
| 6 | With `/bin/sh -s`, a stdin-reading command would swallow the rest of the script and exit 0 with a truncated log that looks complete | **Adopt.** Absence of the `== phase-a pass1 end` marker is now an abort condition |
| 7 | The prose claimed `xcode-select` gates `otool`/`lipo`/`git`, but Pass 1 only records it and contains no such tool | **Adopt.** Prose corrected: Pass 1 records, Pass 2 generation consumes |

Run the generator's guard tests with:

```sh
node --test scripts/gen-phase-a.test.mjs
```

Still unverified, and recorded as such rather than assumed: the remote `/bin/sh`
implementation, Command Line Tools presence, macOS versions, whether
`launchctl list` covers the `gui` domain, whether `tailscale serve status`
launches a GUI helper on an App Store install, and every value behind a
placeholder. The template is syntax-checked with `sh -n` and **has never been
executed anywhere**.

Unverified by that review, and therefore still assumed rather than established:
the remote login shell, Command Line Tools presence, macOS versions, whether
`launchctl list` covers the `gui` domain, and the real values behind every
placeholder. Each has a corresponding runtime check in A1 or is recorded as
"not established".
