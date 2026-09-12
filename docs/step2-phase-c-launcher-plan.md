# Step2 Phase C — trusted launcher and environment plan

Status: **proposed, not implemented.** No code change has been made and no Mac
has been contacted for this phase.

Phase C answers: **when this project starts `imsg`, is the process it creates
the one we intended, in the state we intended?** It does not answer whether the
binary came from reviewed source (Phase B, done) or whether it behaves correctly
(step3).

## The finding that shapes this phase

The plan of record describes Phase C as "define and review a trusted launcher".
That phrasing implies writing something new. It is wrong in a useful way: **the
trusted launcher already exists, split across two places, and one half is much
stronger than the other.**

- `scripts/generate-launch-agent.mjs` starts the server. It is careful: absolute
  `ProgramArguments`, an explicit `WorkingDirectory`, a named environment
  dictionary, and `safeTree()` — which walks *every* path component of the base,
  release, state, log and executable paths rejecting symlinks, foreign owners
  and group/other-writable directories. That is a real immutability check, not a
  gesture.
- `src/server/rpc/readonly-client.ts:53` starts `imsg`:

  ```ts
  this.#child = spawn(options.executable, [...(options.args ?? ['rpc'])], {
    shell: false, stdio: 'pipe', windowsHide: true,
  });
  ```

  **No `env`. No `cwd`.** The child inherits the parent's entire environment and
  working directory. `Options` has no field to pass either, so this cannot be
  fixed by configuration — it is a code change.

There is no environment allow-list or sanitisation anywhere in the codebase.

## Why the careful plist does not cover for it

A launchd `EnvironmentVariables` dictionary **adds to** a job's environment; it
does not replace it. The job receives launchd's base environment, plus anything
set in that domain with `launchctl setenv`, plus the four `IMSG_WEB_*` entries.
Phase A saw that domain dictionary exists and deliberately withheld its
contents, because it can carry credentials.

So a `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS` or `NODE_PATH` set in the user's
GUI domain would reach the server process, and `spawn()` would then hand the
whole set to `imsg`. The plist cannot prevent this. Only an explicit `env` on
the spawn can.

This is not hypothetical on the Intel host, where a separate system already
loads three agents of its own and injects a dylib into Messages at every login.
Nothing suggests it sets such variables; nothing rules it out either, because
this project has deliberately not read that dictionary.

## C1 — The child environment contract

`imsg` is spawned with an **explicit, allow-listed environment**. Not a
deny-list: the generator's `launchctl` and `serve` handling already demonstrated
why — a deny-list silently permits whatever it forgot.

Proposed allow-list, each entry with a stated reason:

| Variable | Value | Why |
|---|---|---|
| `HOME` | the owner's home, from config | `NSHomeDirectory()` decides where the Messages database, the Contacts store and the Messages container live. Wrong `HOME` reads the wrong data. **Not optional.** |
| `PATH` | fixed `/usr/bin:/bin:/usr/sbin:/sbin` | The executable is absolute, but a child of `imsg` may resolve a tool. A fixed value removes a variable. |
| `TMPDIR` | **to be determined** | Whether `imsg` places IPC or scratch files under `TMPDIR` is **not established**. Phase C must read the pinned source and decide deliberately; omitting it silently would be a guess either way. |
| `LANG`, `LC_ALL` | fixed, identical across arms | Collation and formatting can change ordering and string output. A parity claim that does not fix locale is not a parity claim. |

Everything else is dropped, including but not limited to `DYLD_*`, `NODE_*`,
`LD_*`, `SWIFT_*`, `OS_ACTIVITY_*`, `MallocNanoZone`, `SSH_AUTH_SOCK`.

`IMSG_LAUNCH_READY_TIMEOUT`, new in 0.15.3, is **deliberately omitted**: this
project never launches Messages, so a launch-readiness timeout has nothing to
act on. Recording that it was considered and excluded is the point; inheriting
it by accident is what the phase exists to prevent.

## C2 — Working directory

An explicit `cwd`, set to a directory that `safeTree()` has already validated.
Inheriting the parent's cwd means the child's relative-path behaviour depends on
how the server happened to be started.

## C3 — Refuse a compromised parent context

The child contract stops propagation. It does nothing about the **server
process itself**, which launchd starts with whatever the domain provides —
`NODE_OPTIONS` can inject a module into Node before any of this project's code
runs.

A process cannot un-apply `NODE_OPTIONS` after the fact, but it can refuse to
continue. `src/main.ts` gains a startup check: if any of `NODE_OPTIONS`,
`NODE_PATH`, `DYLD_*` or a small named set is present, the server **exits
without serving**, with a fixed-category message and no value echoed.

Fail-closed, and loud. A server that quietly runs under an injected loader is
worse than one that does not start.

## C4 — Path immutability, extended

`safeTree()` already covers the base, release, state and log paths and the Node
executable. It does **not** currently cover the `imsg` executable's full
resolution: `writeLaunchAgent` calls `safeTree` on `realpath(c.imsg)` and its
parent, which is good, but Phase B established that the path is a symlink into a
Homebrew Cellar, and production will now run **a build of ours** instead.

So the check must be re-pointed at the artifact Phase D produces, in a
private `0700` directory under the base — not at a Homebrew prefix, which is
group-writable by design on Intel and changes under `brew upgrade`.

That is a direct benefit of the owner's decision: **the executable moves from a
path the package manager owns to a path this project owns.**

## C5 — SSH versus Agent context

From 0.15.1 onward, `ContactResolver.create` checks `SSH_CONNECTION` /
`SSH_CLIENT` and permits a read-only AddressBook SQLite fallback **only** under
SSH. That means the contact source depends on the environment, and therefore on
this phase.

Three rules, all previously recorded and restated here because C1 is where they
become enforceable:

1. The production Agent environment **contains no SSH variables**, because the
   allow-list does not include them. This is the genuine Agent context.
2. SSH-context measurements are **never presented as Agent-context results**.
   Every Phase A and B observation was taken under SSH and is labelled as such.
3. **SSH variables are never fabricated.** Adding them to make names resolve
   would change the contact source and produce a result about a configuration
   nobody runs.

Note the interaction with C1: clearing the environment is not neutral. Blindly
passing an empty environment *is a choice* to run in the non-SSH branch. That is
the right choice for production, and it must be stated rather than fallen into.

## C6 — What changes in code

1. `Options` in `readonly-client.ts` gains required `env` and `cwd`. Required,
   not optional: an optional field defaults to today's behaviour, and the
   default is the bug.
2. A single module builds the child environment from config. One place, so
   there is one thing to review and one thing to test.
3. `live-source.ts` passes them through; `doctor.ts` and the measurement
   harness use the same builder.
4. `main.ts` gains the C3 startup refusal.
5. `generate-launch-agent.mjs` re-points its executable check at the
   project-owned artifact path.

## C7 — Verification

Tests that **fail if the environment leaks**, not tests that assert it is
configured:

- Spawn a fake executable that prints its own environment; assert the received
  set is exactly the allow-list. Poison the parent with `DYLD_INSERT_LIBRARIES`,
  `NODE_OPTIONS` and `SSH_CONNECTION` first, and assert none arrive.
- Assert the child's `cwd` is the configured one, with the parent started
  elsewhere.
- Assert `main.ts` exits non-zero and serves nothing when each poisoned variable
  is present.
- Assert the builder refuses to emit `SSH_CONNECTION` even if config supplies
  it — fabrication blocked in code, not only in prose.

A guard never shown to fire is not a guard. Each test must be demonstrated
failing against the current code before the fix lands.

## C8 — One bounded read-only probe

To record whether the current launch context is already carrying such variables,
a probe reports the **names only** of GUI-domain environment entries matching a
dangerous pattern, plus a count of entries withheld. **No value is ever read,
printed or stored** — the same rule that made Phase A filter that dictionary.

This is for the record. The defence in C1 does not depend on its outcome.

## What Phase C cannot establish

That the OS presents no permission prompt during a concurrent grant change.
That the injected bridge helper already present on the Intel host is a version
we have reviewed. That a fixed environment makes two hosts comparable — Phase B
recorded that they now differ by compiler as well as OS and architecture. That
`imsg` performs no writes: "non-launching is not zero writes" still holds.

Nothing in Phase C authorizes executing `imsg`.

## F3 review scope

Pre-agreed review point for the launcher and environment packet:

- Does the allow-list omit something `imsg` genuinely needs, such that the
  process silently reads the wrong data rather than failing? `HOME` and
  `TMPDIR` especially.
- Is dropping the environment actually neutral with respect to the SSH branch,
  or does it change behaviour in a way C5 understates?
- Does the C3 startup refusal have gaps — variables that inject before it runs,
  or a way to serve anyway?
- Is `required` on `env`/`cwd` genuinely safer than optional here, given every
  existing call site must be updated?
- Does re-pointing `safeTree` at a project-owned path lose any check the
  Homebrew path was getting?
- Do the C7 tests actually fail against current code, or are any of them
  vacuous in the way the earlier source check was?

---

# F3 review dispositions

Pre-agreed review point for the launcher and environment packet. No reason to
reject the approach: an allow-listed child environment, an explicit cwd and a
parent-context gate all stand. But three findings say **the plan's stated
guarantees do not actually hold as written**, and those are settled here before
any code changes.

Every claim below was re-verified directly against the pinned v0.15.4 source or
this repository, not taken on the reviewer's word.

## The complete list of environment variables imsg reads

Verified by enumerating every `ProcessInfo.processInfo.environment` and
`getenv` in the pinned source. This is the real input to the allow-list, and it
was previously assumed rather than enumerated:

| Variable | Read at | On our read-only path? |
|---|---|---|
| `SSH_CONNECTION`, `SSH_CLIENT` | `ContactResolver.swift:111-112` | **Yes** — selects the AddressBook fallback |
| `HOMEBREW_PREFIX` | `BridgeHelperLocator.swift:31` | Yes — helper search order |
| `IMSG_BRIDGE_LEGACY_IPC` | `IMsgBridgeClient.swift:34` | Yes, but `invokeWithoutLaunching` refuses legacy IPC |
| `DYLD_INSERT_LIBRARIES` | `MessagesLauncher.swift:307-308` | Launch path only |
| `IMSG_LAUNCH_READY_TIMEOUT` | `LaunchReadinessTimeout.swift:22` | Launch path only |
| `PATH` | `AttachmentResolver.swift:204` | Attachment path only |
| `IMSG_VERSION` | `CommandRouter.swift:146` | Display only |

`MessagesLauncher` reading `DYLD_INSERT_LIBRARIES` is worth stating plainly: it
is how the helper gets injected into Messages. A `DYLD_INSERT_LIBRARIES`
inherited from the domain would therefore be carried into a launch. This project
does not launch — but that is the single strongest argument for the allow-list
existing at all.

**`HOME` does not appear.** `MessageStore` derives its default database path
from `homeDirectoryForCurrentUser`, and whether Foundation honours `$HOME` there
is **not established**. That changes finding 1's fix from "pass the right HOME"
to "verify the path that comes back", which is the stronger form anyway.

## Dispositions

| # | Finding | Disposition |
|---|---|---|
| 1 | An allow-list drops stray variables; it does not prove the right value was passed. A wrong `HOME` makes imsg open a different `chat.db` and **succeed** | **Adopt.** Take the home directory from `os.userInfo().homedir` (passwd), never `os.homedir()`, which prefers `$HOME`. Add a **positive check**: the `database.path` returned by status must equal the expected path or the source fails. `live-source.ts:77` currently only checks that it is absolute. This converts "reads the wrong data" into "fails". |
| 2 | `cli-status.ts:11` spawns with no env or cwd too — the same defect — and it is the CLI `status` path that can launch and repair Messages | **Adopt; owner decision below.** Verified. The plan's claim that `IMSG_LAUNCH_READY_TIMEOUT` has "nothing to act on" was justified by the wrong reason: it is omitted because we choose the default deliberately, not because no launch path exists in the codebase. |
| 3 | The C7 startup-refusal test is vacuous: `main.ts` funnels **every** failure into one catch, one message, `exitCode = 1` | **Adopt.** Verified by reading `src/main.ts:33`. A poisoned-environment test would pass today against unmodified code — the same species as the source check that could not fail. The refusal gets its own fixed-category message, and every test needs a **control**: same config unpoisoned must reach `Read-only server ready`. |
| 4 | `TMPDIR` was left undetermined | **Resolved from source; owner decision below.** imsg's own `temporaryDirectory` use is confined to `RichLinkPreparer`, `AppleScriptSendTransport` and `AttachmentResolver` — all send/attachment paths, none of them ours. But macOS links the **system** libsqlite3, whose temp-file location follows `SQLITE_TMPDIR`/`TMPDIR`. Dropping it would silently move SQLite spill files from a per-user `0700` directory to a shared one. Set it explicitly rather than omit it. |
| 5 | C3 is a tripwire, not a boundary: a module loaded by `NODE_OPTIONS=--require` runs first and can delete the variable before the check sees it | **Adopt.** The wording is corrected: C3 catches a setting left lying around, not an adversary. Variables are matched by **prefix** (`NODE_`, `DYLD_`, `UV_`, `SQLITE_`) plus a named set, rather than enumerated. The guard becomes an import-free module placed as the **first import statement** of every entry point, since ESM evaluates static imports before the body — `main.ts`, `doctor.ts` and the two probe scripts. |
| 6 | `safeTree(imsg, uid, true)` passes `allowAdminGroup=true`, a relaxation for Homebrew's group-writable prefix, and the plan did not say to undo it. Separately, `safeTree` runs only at plist-generation time — **nothing checks the executable at spawn time** | **Adopt.** Set `allowAdminGroup=false` for a project-owned path, add `within(base, imsg)` to `validateConfig`, and add a spawn-time check in the builder: regular file, owner match, not group/other-writable, no symlink component, digest matching what Phase D recorded. TOCTOU remains; "checks nothing" is a different category. |
| 7 | C5 looks only at the environment and ignores TCC attribution; and the locale claim overstates | **Adopt.** Under SSH the responsible process is sshd; under the Agent it is the Node binary, so sanitising the child's environment does not make an SSH measurement an Agent measurement. Darwin Foundation takes locale from user preferences rather than `LANG`, and SQLite collation is BINARY, so fixing `LANG`/`LC_ALL` is harmless but is **not** the basis of a parity claim. Both corrected. |
| 8 | `env`/`cwd` required is right, but `env: process.env` would type-check and defeat it | **Adopt.** The field takes a branded type constructible only by the builder. |
| 9 | `launchctl setenv` from an SSH session lands in `user/<uid>`, which may not be the `gui/<uid>` domain the Agent loads into | **Adopt.** The C8 probe must state which domain it read, and Phase A's record must say which domain its withheld dictionary came from. |
| 10 | Unaddressed: fd inheritance, process group, umask, resource limits, and `imsg rpc`'s SIGTERM/EOF behaviour | **Adopt as scope.** Added, with one test asserting the child sees only fds 0-2. |

Also adopted from finding 6, and independently verified: `BridgeHelperLocator`
searches `.build/release/<helper>` and `.build/debug/<helper>` **relative to the
current working directory**. So the cwd chosen in C2 is not cosmetic — a cwd
containing a build tree could change which helper is found. The cwd must be a
directory with no `.build`, and C4's "we have moved away from Homebrew" needs
the caveat that helper resolution can still reach a Homebrew path.

Finding 3 also breaks existing tests, and that is the correct outcome:
`tests/fixtures/fake-doctor.mjs` reads `DOCTOR_TEST_MODE` and
`DOCTOR_TEST_MARKER` from the **inherited** environment, so the doctor tests
fail the moment doctor uses an allow-list. They move to argv, as `fake-imsg.mjs`
already does. Passing those two variables through the allow-list "for tests"
would be a hole punched in the thing being built.

## Owner decisions

1. **`doctor` / `cliStatus`.** This is the CLI `status` path that upstream may
   use to launch or repair Messages, and `npm run doctor` is already forbidden
   as a preflight. Options: bring it under the same env/cwd contract, or place
   it explicitly out of scope and guarantee by construction that it is never
   reachable under the Agent. Recommendation: **bring it under the contract**,
   because "never reachable" is a claim that has to stay true forever.
2. **Where `TMPDIR` points.** Either a project-owned `0700` directory under the
   base — which uses the directory-creation permission already given — or the
   per-user value launchd provides, validated at startup (absolute, exists,
   owned by us, `0700`, no symlink component). Recommendation: **the
   project-owned directory**, because it is ours to reason about.
3. **The GUI-domain environment dictionary.** Reading or clearing it is an
   operation on the owner's session, not something this project does. The C8
   probe will report matching **names only**, never values. Whether to then
   clear anything it finds is the owner's call.

---

# C8 result and implementation record (2026-09-12)

## C8 — the launch context was not already carrying anything

Read-only probe of both launchd domains on both hosts, reporting **names only**
for entries matching a dangerous pattern and counting the rest without naming
them.

| Host | `gui/<uid>` matched | `user/<uid>` matched | withheld |
|---|---|---|---|
| Intel | **0** | **0** | 1 in `gui`, 0 in `user` |
| M1 | **0** | **0** | 1 in `gui`, 0 in `user` |

No `NODE_*`, `DYLD_*`, `UV_*`, `SQLITE_*`, `IMSG_*`, `SSH_CONNECTION`,
`HOMEBREW_PREFIX`, `CFFIXED_USER_HOME` or TLS-path override in either domain.
Nothing to clear, and the owner's decision to be told names rather than have
anything cleared stands unused.

Both domains were read because `launchctl setenv` from an SSH session lands in
`user/<uid>` while an Agent with `LimitLoadToSessionType=Aqua` loads into
`gui/<uid>`; reporting one without saying which would have been misleading.

This does not change the defence. The child environment is an allow-list, so the
contents of these dictionaries no longer reach `imsg` either way. What it
establishes is narrower and worth having: the context was **not** already
compromised, so the historical measurements were not taken under an injected
loader.

## Implementation, and one test that had to be thrown away

The contract is implemented and the leak was demonstrated before the fix: with
the parent poisoned, the child died reading a `NODE_OPTIONS --require` that did
not exist, and the cwd assertion returned the parent's directory verbatim.
Removing the two lines that pass `env` and `cwd` makes those tests fail again.

One test was written, run, and discarded as the wrong instrument. It asserted
that the child held no descriptor above its own stdio, and it failed — the child
reported roughly twenty. That looked like a finding and was not: **a fresh Node
process already holds that many for libuv's event loop**, and a parent process
shows exactly the same count. The assertion was measuring the runtime, not
inheritance, and would have reported a leak that does not exist.

Replaced with a differential: count the child's descriptors, open twelve more in
the parent, count again. The difference is zero, on both a plain parent and
through the client. That is the form that answers the question.

Recording this because the failure mode is the mirror image of the one this
project keeps catching. A check that cannot fail proves nothing; a check that
fails for the wrong reason is worse, because it looks like evidence.

## Remaining Phase C work

- `safeTree(imsg, uid, true)` must become `false`, and `validateConfig` must
  require the executable to sit under the base. Deferred until Phase D produces
  the artifact, since the path being validated does not exist yet.
- Process-group and `ExitTimeOut` interaction with the Agent's shutdown
  sequence, and `imsg rpc`'s behaviour on stdin EOF versus SIGTERM, are checked
  against the real binary in Phase D's non-launch tests.
