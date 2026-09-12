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
