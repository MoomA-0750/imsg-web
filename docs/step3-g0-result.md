# Step3 rung G0 — does the product resolve through `$HOME`? (2026-09-13)

Run on M1 only, with owner authorization. No real data was read. Everything
created lives under a fresh private run root.

## The answer: no. `NSHomeDirectory()` ignores `$HOME`.

| | |
|---|---|
| decoy lock staged at | `<run root>/Library/Containers/com.apple.MobileSMS/Data/.imsg-bridge-ready` |
| decoy present at run time | yes, 0 bytes, confirmed by `stat` and by `ls` after the run |
| `bridge` in the response | `{"ready":false,"error":"The bridge is not started. Run imsg launch explicitly before using bridge methods."}` |
| that error belongs to | `.unavailable` — **the decoy was never looked at** |
| `database.path` | the fixture, as passed by `--db` |
| `contacts.available` | `false` |
| product exit | 0 |
| `.imsg-rpc` created under the decoy | no — never made |
| real container lock | absent before, absent after |
| fixture digest | unchanged |

**The competing explanation was ruled out before the conclusion was drawn.**
A decoy could have been ignored because the lock test demands more than
existence — a fresh mtime, a PID, a non-empty body. It does not:

```swift
public func hasReadyLockFile() -> Bool {
  if let readyCheckOverride { return readyCheckOverride() }
  return FileManager.default.fileExists(atPath: lockFile)
}
```

A bare `fileExists`. So a zero-byte `touch`ed file satisfies it, and the only
remaining explanation for `.unavailable` is that `lockFile` did not resolve to
the decoy — that is, `NSHomeDirectory()` returned the real home.

## What this changes

**1. Setting `HOME` does not confine the product.** Every phase so far has run
the product under `env -i HOME=<private>`, and the implicit assumption was that
this also moved where it looks for things. It does not. `--db` is the only lever
that moves anything, and it moves the database alone.

**2. Every run stats the real Messages container, on every host, always.** Not
as a quirk of `status` — as the resolution of `NSHomeDirectory()`.

**3. The Phase C choice of `passwdHome()` was right, and now for an observed
reason.** `child-env.ts` derives `HOME` from `userInfo().homedir` rather than
from `process.env.HOME`, and `live-source.ts` checks the reported
`database.path` against a path derived the same way. Since the product resolves
its own default through the passwd home, the application's expectation and the
product's behaviour agree. That was a judgement call at the time; it is now
backed by an observation.

**4. Intel stays shut for `status`.** A run there under any `HOME` would find
the real ready lock and perform IPC with the 0.14.2 dylib injected into a running
Messages.app. That was the original reason for excluding Intel, previously
assumed and now established.

## A route to Intel that does not touch the bridge

`status` is the only read method whose handler calls `bridgeSnapshot()`.
`chats.list` declares no bridge requirement —

```swift
RPCMethodDescriptor("chats.list", route: .chatsList, lane: .read, database: [.ready]),
```

— and `handleChatsList` is self-contained: `databaseResources.require()`,
`listChats`, `chatInfo`, `participants`, `contactNameForChat`, `respond`. It
contains no bridge reference. Against a fixture it would exercise what Intel has
never shown: server start, database open, bundle resolution, request parse,
response emit, clean exit.

**This is a source claim, not an observation, and it is labelled as one.** It
cannot be confirmed on M1, because M1's bridge is never ready, so the branch is
not taken there for any method. Confirming it by planting a decoy where the
product actually looks would mean writing into the owner's real Messages
container — which this project does not do.

So the rung would carry a **detector rather than a guarantee**: record the real
container's `.imsg-rpc` inbox and outbox counts and mtimes before and after, and
treat any change as a detected IPC. That detects a violation; it does not
prevent one. The residual risk is the owner's to accept, not mine to assume.

## Correction — the F2 "rollback journal" fixture is a zero-byte file

`docs/step2-phase-f-result.md` records the second F2 fixture as "rollback
journal, `e3b0c442…`". **`e3b0c442…` is the SHA-256 of the empty string.** The
file is 0 bytes.

I named it for what I set out to build — a `journal_mode=delete` database —
rather than for what the digest in my own table was telling me. SQLite opens a
zero-length file read-only as a valid empty database, which is why it returned
`ready: true`.

What survives: the WAL diagnosis is unaffected, since that failure was about
missing `-shm`, and the bundle-resolution conclusion is unaffected, since
`ContactResolver` is constructed before any database work. What does not
survive is any implication that F2 exercised a database **with content**. It did
not, and step3's fixtures have to be built and verified by inspection rather
than by intent.

## Residue

Under the private run root: the run script, the fixture copy, the decoy
container and its lock file. Nothing outside it was created or modified;
`.imsg-rpc` was never made. Nothing was deleted.
