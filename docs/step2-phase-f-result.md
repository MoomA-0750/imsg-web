# Phase F / F1 — first execution result (2026-09-13)

The first time this project has executed `imsg`. Run on both hosts with the
owner watching both screens.

| | Intel | M1 |
|---|---|---|
| stdout / exit | `0.15.4` / 0 | `0.15.4` / 0 |
| quarantine attribute | none | none |
| `codesign --verify` | `code object is not signed at all` (1) | **`valid on disk`, satisfies its Designated Requirement** (0) |
| crash reports | unchanged | unchanged |
| process count before / after | 671 / 671 | 598 / 598 |
| `imsg` mentions in the TCC log | **0** of 1080 lines | **0** |
| bridge ready lock | **PRESENT** | absent (container readable) |

Every value matches what the plan predicted before the run, which is the point
of having written predictions down. The unchanged process counts show the child
exited rather than lingering; the empty TCC log shows no permission machinery
was touched, which the structure of `--version` made unreachable rather than
merely unlikely.

The signing asymmetry behaves as the platform explanation says: the unsigned
x86_64 product runs, and the ad-hoc signed arm64 product verifies and runs.

Nothing was written to either host by F1.

## The Intel ready lock, and why stopping the agents does not help

F1's lock check was three-valued on purpose. Intel returned **present**, with a
recorded mtime of **Aug 30** — roughly two weeks old, not from any recent
activity.

The owner chose to stop the three foreign agents so that F2 could run on Intel
without touching another system's live bridge. Reading the pre-stop state shows
that this does not achieve it:

- `xyz.mooma.imsg-claude.watcher` is PID 57382, up 8 days, with a child
  `/usr/local/Cellar/imsg/0.14.2/libexec/imsg watch --json`.
- The ready lock's mtime predates both by days. It was created when the `inject`
  agent ran `imsg launch`, and it belongs to the **dylib injected into the
  running Messages.app**, not to the watcher.
- Messages.app is running.
- The RPC inbox and outbox are both empty.

`launchctl bootout` removes the agents and their processes. It does not
un-inject a dylib from a process that is already running, and nothing removes
the lock file. So after stopping the agents, `status` on Intel would **still**
find the lock present and **still** perform IPC — with the injected bridge
inside Messages.app, now with no watcher alongside it.

What stopping does buy is narrower than intended: no concurrent user of that
bridge during the run. What it does not buy is the thing it was chosen for.

The version skew also remains: our product is 0.15.4 and the injected dylib
came from stock 0.14.2. How that protocol pair behaves is **not established**.

Nothing has been stopped. The mutation was not performed, because performing it
would not have served the purpose it was approved for.

---

# F2 and F3 — M1 only, by the owner's choice of (a)

Intel was excluded because its bridge ready lock is present and belongs to the
injected dylib in a running Messages.app, which stopping the agents would not
have changed.

## F2 — one `status` request, then EOF

| | first fixture (WAL) | second fixture (rollback journal) |
|---|---|---|
| `database.ready` | **false**, with an error naming Full Disk Access | **true** |
| `contacts.available` | false | false |
| `bridge.ready` | false | false |
| exit on EOF | 0 | 0 |
| fixture digest before / after | unchanged | unchanged |

> **Correction, 2026-09-13.** The second fixture is named "rollback journal"
> here, but `e3b0c442…` is the SHA-256 of the empty string: the file is 0
> bytes. It was named for what I set out to build rather than for what the
> digest in this table already said. SQLite opens a zero-length file read-only
> as a valid empty database, which is why it returned `ready: true`. The WAL
> diagnosis and the bundle-resolution conclusion are unaffected; the claim
> that F2 exercised a database with content is withdrawn. See
> `docs/step3-g0-result.md`.

### The first fixture failed because of how I made it

I built the fixture in WAL mode deliberately, to see whether a read-only
connection creates `-wal`/`-shm` sidecars, and removed the sidecars before
sending it. That combination cannot work: **a WAL database needs its shared-memory
file, and a read-only open without it fails.** The failing condition was my own.

The error text says "grant Full Disk Access to the supervising process", which
reads like a permissions problem. It is not one here: `shasum` in the same script
read the same file moments earlier, and the seven TCC log lines from the run are
`AUTHREQ_ATTRIBUTION` entries attributed to `com.apple.sshd-keygen-wrapper` —
authorization *queries*, not denials.

**Had the error message been trusted, the conclusion would have been "the binary
needs Full Disk Access", and that is wrong.** A rollback-journal fixture, identical
in every other respect, returned `ready: true` on the first try.

Two things worth carrying forward:

- A read-only open of a WAL database **fails when its sidecars are absent**. The
  real `chat.db` is WAL and its sidecars are live because Messages runs. A
  measurement taken with Messages quit is not obviously the same situation, and
  step3 has to account for that rather than assume.
- An error message naming a permission is not evidence about permissions.

### What F2 established

- **The resource bundle directory resolves.** `ContactResolver` constructs
  `PhoneNumberNormalizer` → `PhoneNumberUtility` before `RPCServer` exists, and a
  missing bundle is a `fatalError`. A response came back, so it resolved. Whether
  the *metadata inside* loads is still unobservable here, because a synthetic
  database normalises no numbers.
- `contacts.available: false` — the address book was not enumerated.
- `bridge.ready: false` — no lock, so no IPC.
- `--db` works: the reported path is the fixture, not `~/Library/Messages`.
- The fixture's digest is unchanged, so read-only held in practice, not just in
  the source.

## F3 — terminated by `SIGTERM`

Predicted from the source, which contains no `SIGTERM` handler anywhere in
`Sources`: default disposition, status 143.

```
started pid 41441, alive after 3s
kill -TERM  → 0
product exit after SIGTERM → 143
ps after    → gone
```

No residue: fixture digest unchanged, no sidecars, process count 598 before and
after, ready lock still absent.

`kill` is forbidden by every other generator in this project. The F3 generator
permits exactly `kill -TERM "${CHILD}"` and nothing else, where `CHILD` is the
PID this script started — `kill -TERM 57487`, `kill -9`, a negative PID for the
process group, and `killall` are each refused by test.

## Phase F is complete, and what it did not settle

The real `chat.db` was never opened. No contact was resolved, so nothing is known
about name resolution. Nothing is known about timing. Intel's F2/F3 were not run,
so only the arm64 product has been exercised beyond `--version`.

The permission question is also still open in the direction that matters: nothing
here needed Full Disk Access, because nothing here touched a protected path. A
real-data run will, and the self-built binary has no grant of its own.
