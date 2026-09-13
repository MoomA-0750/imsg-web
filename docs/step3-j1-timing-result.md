# Step3 rung J1 — RPC-level timing, baseline vs candidate (2026-09-13)

M1, Messages not running, load average ~2.0. Workload fixed by one preflight:
`chats.list(25)` plus five `messages.history(25)`. Six cycles per arm per pass,
two passes, arms interleaved.

**This is not C06.** It measures `imsg` over stdio, with no HTTP, no
authentication, no DTO serialisation, no RSS sampling and no soak.

## Result

| warm, median (p95) | baseline | candidate |
|---|---|---|
| `chats.list` | 168.0 ms (194.1) | **43.8 ms (46.1)** |
| `messages.history` | 135.6 ms (194.1) | **45.8 ms (48.2)** |
| **full cycle** | **835.5 ms (963.3)** | **264.3 ms (280.7)** |
| cold cycle | 643.0 ms | 369.3 ms |

**The candidate is 68.4% faster on the warm cycle**, and it is also far steadier:
baseline warm cycles ranged 719.6–963.3 ms, the candidate 258.0–280.7 ms. The
patch removes both time and variance.

So the contact-batch patch does what it was written to do. Until today that was
an assumption: parity established it returns the same answers, and nothing had
ever established it returns them sooner.

## The counterbalancing earned its place

Wall time per pass:

```
pass 1  baseline 4663 ms    candidate 1683 ms
pass 2  candidate 1754 ms   baseline 5872 ms
```

**The baseline got 26% slower between its two passes while the candidate moved
2%.** Something on the machine drifted — heat, background work, page cache, the
load average was already 2.0. Had the run been "all of baseline, then all of
candidate", that drift would have sat entirely inside the comparison and been
read as part of the effect.

The arms were also in opposite orders across passes: the candidate ran *second*
in pass 1 and *first* in pass 2, and was fast both times. So the result is not an
artefact of one arm inheriting a warm OS page cache from the other.

## What this does not say

- **Nothing about C06.** The historical acceptance figures — warm API-cycle p95
  3,834 ms Intel / 5,282 ms M1 — are for the full authenticated API cycle
  through release `a342425` with its old CLI-injected workload, which
  `AGENTS.md` forbids reusing or repointing. They are not a baseline for these
  numbers and no ratio between the two should be computed.
- **Nothing about how much of the API cycle this is.** Saving ~570 ms inside
  `imsg` only moves the API cycle by that much if the rest is unchanged, and the
  rest has not been measured with the current artifacts.
- **Nothing about memory.** C06 also bounds RSS over 20 samples and 30 minutes.
- **Nothing about Intel**, whose execution remains undecided, and whose product
  came from a different dependency graph.
- **Nothing about larger workloads.** History was capped at 25 messages over 5
  chats. Contact batching is precisely the kind of change whose benefit scales
  with record count, so this figure is a point measurement, not a curve.

## Method notes worth keeping

- One request in flight at a time. The server answers concurrently and out of
  order, so overlapping requests cannot be attributed to a duration; responses
  are matched by JSON-RPC id regardless.
- Cold and warm reported separately, because the first call in a process pays
  for catalog loading and averaging it in would hide the effect.
- Both arms answer the identical fixed question set, taken from one preflight,
  so neither chooses its own workload.
