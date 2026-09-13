# The C06 harness, and a blocker it found before any Mac run

Built and tested on the Linux workstation against a synthetic `imsg`. **No Mac,
no real `imsg`, no Messages data, and no C06 acceptance** — `gateMeasurement`
stays `false` in every module, because thresholds are a separate judgement none
of them knows or may apply.

## The blocker: the application declares our own products untested

`src/server/capabilities.ts`:

```ts
export const TESTED_VERSIONS = ['0.14.2', '0.15.1'] as const;
```

Our four class-R products are **0.15.4**. Run through the current application:

```
0.15.1 -> chats: {"state":"available","reasonCode":"SUPPORTED"}
0.15.4 -> chats: {"state":"unknown","reasonCode":"VERSION_UNTESTED"}
```

Every read capability comes back `unknown / VERSION_UNTESTED`, for both `chats`
and `history`. The C06 workload requires `available` and fails at the
capabilities stage — its very first request — so **C06 cannot run on the current
artifacts at all**, and the deployed UI would report its read features as
unknown.

This was found because the harness was built locally first. It would otherwise
have appeared as a failed first cycle part-way through a 30-minute soak on the
owner's machine.

**No production code was changed in response at the time.** Widening
`TESTED_VERSIONS` is an assertion that 0.15.4 has been tested, and that is the
owner's call, not a silent edit made to get a harness to go green. The test
fixture reported 0.15.1 instead, with a comment saying why.

### Resolved 2026-09-14 — the owner chose to widen the list

`0.15.4` was added, with the evidence and the ordering caveat recorded in a
comment on the constant itself rather than only in this file. Two tests now
guard it in both directions: 0.15.4 must be usable, and 0.15.3, 0.15.5, 0.16.0
and 1.2.3 must all still come back `VERSION_UNTESTED` — because widening a list
without checking the other half is how widening quietly becomes removing. A
third test confirms a tested version cannot rescue a wrong protocol version.

The harness fixture now reports 0.15.4, which is what the class-R products
report, so the end-to-end test exercises the real combination.

What evidence exists today for such an assertion: parity EQUAL on real data,
phone-derived contact resolution confirmed, RPC-level timing, a real read-only
`chat.db` open that modified nothing. What does not: anything through the
application's own HTTP surface on 0.15.4, which is what C06 would establish —
so the list would be widened *before* the evidence that justifies widening it.

## The modules

| module | what it is for |
|---|---|
| `nonlaunch-c06-admission.mjs` | which bytes are about to run: resolved path, `lstat` on every component to the root, regular file owned by this uid and not group/world-writable, digest matching one named in advance |
| `nonlaunch-c06-launcher.mjs` | builds the application from its own parts — never `startRuntime` or `OwnerStore` — with an in-memory key, every child registered through the production `onChild` seam, and a loopback ephemeral port |
| `nonlaunch-c06-soak.mjs` | many cycles against one long-lived app, memory on an independent clock, every raw record kept |
| `nonlaunch-c06-supervise.mjs` | signals, a hard watchdog, and a report that cannot claim cleanup it did not watch |

Totals: 18 + 14 + 13 tests, plus the existing 8 / 6 / 7. Typecheck and the 164
application tests pass on the pinned Node 24.20.0.

### The supervisor's one real guarantee

If the watchdog fires, the run is **failed with ownership uncertain**, and
`residueClaim` says in words that the supervisor stopped observing rather than
that anything exited. Its timers cannot preempt blocking code — nothing in a
single-threaded runtime can — so the guarantee is deliberately the weaker,
honest one.

## Three fixture bugs, each of which taught something real

1. **`indexOf('--db')` returned −1**, so `argv[0]` — the Node path — was
   reported as the database. The application spawns `rpc` with **no `--db`**;
   only the measurement rungs pass one. Worth knowing: production and the rungs
   resolve the database differently.
2. **A single byte on stderr failed the run.** The owned-reader gate treats any
   child stderr output as a fault. A debug line in the fake produced
   `READER_RECOVERY_REQUIRED`, which is the gate working exactly as designed.
3. **`LiveSource` fingerprints the database file**, it does not merely compare
   the reported path. So the path must exist. That check is what turns "imsg
   opened a different chat.db and succeeded" into a failure, so the test creates
   the file rather than the launcher relaxing the check — and creates it only if
   absent, removing it afterwards.

## Still outstanding before a live C06 run

- ~~The `TESTED_VERSIONS` decision above.~~ Made 2026-09-14; the list now
  includes 0.15.4 and the harness runs end to end against it.
- Counterbalanced cross-arm scheduling at the application level, which J1 showed
  matters: the baseline drifted 26% between passes while the candidate held flat.
- A LaunchAgent to run it in the production context. This environment refuses to
  create launchd plists, so the owner places it, as in rung H2.
- Intel, still undecided.
