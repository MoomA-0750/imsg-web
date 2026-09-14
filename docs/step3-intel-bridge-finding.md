# Intel: every API request reaches the owner's other bridge (2026-09-14)

Read-only inspection plus the pinned v0.15.4 source. Nothing was executed on
Intel and nothing was changed there.

## The chain

`LiveSource.#context()` ends with `await this.#adapter!.status()`, and there is
**no cache**. `capabilities()`, `chats()` and `history()` each call `#context()`.
So **every API request runs an `imsg status` RPC**, and one C06 cycle —
capabilities, chats, history — runs **three**.

`status` calls `bridgeSnapshot()`, which begins `guard isBridgeReady()`, which
is a bare `fileExists` on `<container>/.imsg-bridge-ready`. When that file is
present, `status` proceeds to `invokeWithoutLaunching`: it writes
`<uuid>.json` into `<container>/.imsg-rpc/in/`, polls, and reads
`<container>/.imsg-rpc/out/<uuid>.json`.

That container belongs to the owner's separate `imsg-claude` system.

## Intel's state today, and what it costs

| | |
|---|---|
| ready lock | **PRESENT**, mtime Aug 30, 4 bytes |
| Messages.app | **not running** |
| foreign agents | `watcher` (pid 57382, up 9 days), `nightly`, `inject` |
| foreign `imsg` | pid 57487, `0.14.2/libexec/imsg`, child of the watcher |
| IPC inbox / outbox | 0 entries each, mtime Sep 9 |

Messages is not running, so **the dylib that lock belonged to is gone**. The lock
is stale. Nothing is listening on that inbox.

`IMsgBridgeProtocol.defaultResponseTimeout` is **10 seconds** for `status`. So a
single API request on Intel today would write a file into the foreign inbox,
poll for ten seconds, time out, and return `probeFailed`.

**Three requests per cycle × 10 seconds = 30 seconds of timeout per C06 cycle,
against a 15-second slot.** A C06 run on Intel as it stands would not measure
the application; it would measure the timeout. That is arithmetic, not judgement.

Residue is at least bounded: on the `.unclaimed` path the client removes its own
request file, which is the path that applies when nothing claims it.

## The larger finding, which is about production and not measurement

Intel is the intended production host. In normal use Messages **is** running and
the `inject` agent **has** injected the bridge, so the lock is live and the
bridge answers quickly — no timeout.

But the interaction is still there. **In production on the iMac, this read-only
web UI would perform an IPC exchange with the owner's separate `imsg-claude`
bridge on every single API request** — writing a file into its inbox and reading
one from its outbox, three times per UI cycle.

Nobody decided that. It is not in `p0c-operations.md`, which describes the
data path as `browser -> Serve -> loopback -> read-only imsg child` and says
nothing about a second system. The historical C02 Intel run recorded
"read-state / typing capability: available", which is derived from bridge
readiness — so the deployed application was already talking to that bridge, and
its 4,546 ms cycle included whatever that cost.

This is a design-level fact about the intended deployment, discovered while
working out how to measure it.

## What could be done, and by whom

**Not by me.** `AGENTS.md` forbids removing stale lock state and changing
existing watchers or Agents without explicit scope, and this is another
system's state.

1. **The owner removes the stale lock.** It is their file; Messages is not
   running so nothing owns it; their `inject` agent recreates it at the next
   login if their system wants it. `status` then returns `.unavailable`
   immediately, with no IPC and no timeout, and Intel becomes measurable.
2. **Measure M1 only and deploy Intel unmeasured.** The owner has accepted this
   shape before, conditional on the artifact working on both architectures —
   but that condition is still unmet, and this finding adds a second gap: the
   production host's behaviour differs from the measured host's in a way that is
   now known rather than suspected.
3. **Decide the production interaction on its own terms.** Whether the web UI
   should talk to `imsg-claude`'s bridge at all is a question about the product,
   not about C06, and it does not go away when the measurement does.

Option 3 is the one that outlives this phase, and it is worth an answer whether
or not Intel is ever measured.
