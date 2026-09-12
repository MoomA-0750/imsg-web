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
