# Step3 rung I — parity on real data (2026-09-13)

M1 only, baseline vs candidate, same host, same toolchain, same product pair.
Messages was not running, so the database was static.

```
baseline stable across its two runs: true
candidate stable across its two runs: true
baseline == candidate:               true
== PARITY: EQUAL
```

| | |
|---|---|
| chats compared | 25 |
| history calls | 5 × 25 messages |
| with a resolved `contact_name` | 14 of 25 |
| **of those, phone-shaped identifier** | **7** |
| of those, email-shaped identifier | 7 |
| absolute verdict | **PASS** |
| exits / signals / stderr bytes | 0 / null / 0, all four runs |

Values never left the Mac. The comparator prints verdicts, counts, record
positions and field names from a fixed list; message text, handles, senders and
contact names are HMAC'd under a per-run key that is never written down.

## The absolute check is the part parity could not have given

Phase D left a hazard: PhoneNumberKit's bundle **directory** resolves, but a
present directory with unreadable metadata is swallowed inside
`populateTerritories`, which continues with empty territories. Both arms carry
byte-identical copies of that bundle, so a degraded one degrades both and parity
passes over a broken product.

**Seven chats resolved a name from a phone-shaped identifier.** Phone-number
normalisation therefore ran with real territory data. Email-derived resolution
would not have shown this — an email handle resolves without normalisation —
which is why the verdict is four-valued and only phone-derived resolution counts
as a pass.

That closes the Phase D hazard by observation.

## The finding that was not a finding

The first two real runs reported **INCONCLUSIVE: an arm disagreed with itself**.
Run one blamed the candidate. Run two blamed the *baseline*.

An arm that is non-deterministic on a static database is a serious defect, and
"the contact-batch patch introduces non-determinism" is a plausible, tidy story
— the patch does request-local batching and stale in-flight invalidation.

**It was my comparator.** It matched responses to requests by arrival order.
Sending `chats`, `hist-0`, `hist-1` and reading the returned ids directly shows:

```
run 1 ids: chats hist-0 hist-1
run 2 ids: chats hist-1 hist-0
run 3 ids: chats hist-1 hist-0
```

The RPC server answers concurrently, so the order varies between runs. Comparing
one chat's history against a different chat's history produces exactly the
symptom seen: `only in first: 25, only in second: 25`.

The tell was that **the accusation changed arms between two runs of the same
experiment**. A real defect in the candidate does not migrate to the baseline.

The comparator now correlates by JSON-RPC id and reports missing ids explicitly.
The application's own client (`readonly-client.ts`) has always keyed by id —
`this.#active.get(record.id)`, with a deliberate guard that a numeric lookalike
must not resolve a request — so nothing in the product was affected. Only the
measuring instrument was wrong.

Two things this makes concrete, both worth keeping:

- **Out-of-order responses are a property of the server**, observed rather than
  assumed. Any future harness has to correlate by id, and C06's timing harness
  will need to attribute per-stage timings the same way.
- The drift check earned its place. Without an arm being compared against
  itself, the very first run would have produced "candidate unstable" with
  nothing to contradict it.

## What this settles, and what it does not

Settled: on 25 chats and 125 messages of real data, the candidate returns
exactly what the baseline returns — same records, same order, same resolved
names, same payloads — and both are reproducible on a static database. Contact
resolution works, including through phone-number normalisation.

Not settled: **this is not a performance result.** Nothing here is timed, and
C06 remains untouched. Nothing about Intel, whose execution is still undecided.
Nothing about larger limits: 25 chats was the whole list, but history was capped
at 25 messages over 5 chats, and a longer history is a different workload.
Nothing about the LaunchAgent context — parity ran over SSH, and while both arms
shared that context so the comparison is sound, C06 must be measured where
production runs.
