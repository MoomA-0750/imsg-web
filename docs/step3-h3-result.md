# Step3 rung H3 — the first real `chat.db` open (2026-09-13)

M1 only. One `status`, then EOF. `status` returns readiness and nothing else:
no chat, no message, no handle.

The bridge ready lock was absent, so no IPC occurred.

## Result

```
database.ready: true
database.path : the real chat.db
contacts.available: false        ← no flag passed; contacts are a later rung
bridge.ready: false
product exit: 0
```

| | before | after |
|---|---|---|
| `chat.db` size | 17,596,416 | **17,596,416** |
| `chat.db` inode | 45582 | **45582** |
| `chat.db` mtime | Sep 10 15:34 | **Sep 10 15:34** |
| `chat.db-wal` size / mtime | 3,728,632 / Sep 13 02:06 | **identical** |
| `chat.db-shm` size / mtime | 32,768 / Sep 12 01:54 | **identical** |

**Nothing moved.** Not the database, not either sidecar, not even an mtime.
That is a stronger read-only demonstration than the plan asked for: a read-only
WAL open is entitled to touch `-shm`, and this one did not.

The reported feature set is a real schema — `unread_state`, `reply_context`,
`balloon_payloads`, `routing_metadata`, `reactions`, `scheduled_messages` all
true — against the empty fixture, which had them all false. So the open was real,
not nominal.

## A plan assumption was wrong, and it makes step 3 easier

The plan said, twice and emphatically:

> The real `chat.db` is WAL, and its `-wal`/`-shm` sidecars are live **because
> Messages runs**. A read-only open without the shared-memory file fails.
> Whether Messages is running is therefore part of the measurement condition.

**Messages was not running for this rung** — `ps` found no `MobileSMS` process —
and the open succeeded anyway. The sidecars persist on disk after Messages
quits; they are files, not something the running process holds in being.

The half that was right is that a WAL database needs its sidecars: F2 proved
that by failing when they were removed. The half that was wrong is attributing
their existence to a running Messages.

This is worth more than a correction. With Messages quit the database is
**static**, which is the measurement condition parity actually wants: the
ordering-stability check becomes meaningful instead of racing incoming
messages, and the ABBA design guards against a drift that, in this condition,
should not occur at all. If it does occur, that is itself a finding.

## What this settles

The product opens the owner's real database, read-only, in fact and not just in
the source. The path it reports is the one passed. No bridge interaction, no
contacts, no crash report, no residue.

## What it does not

Nothing about whether it reads the contents *correctly* — `status` reads no
content. Nothing about contact resolution against real handles. Nothing about
Intel. Nothing about timing.
