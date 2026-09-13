# Standing check — is there a newer `imsg`, and should we take it?

Status: **policy decided 2026-09-13, procedure not yet implemented.**

The owner asked for a re-check at each Web UI code update, motivated by not
wanting to sit on an old version years later. This is that check's contract.

It is written as a check that **can fail**, because the failure this project has
already committed once is the opposite: a verification whose structure made
"fine" the only reachable answer. Four of nine audited paths did not exist, and
`git diff` on a nonexistent path prints nothing.

## Current position

Pinned: **v0.15.4** (`e2f5046`). Upstream latest as of 2026-09-13: **v0.15.4**,
released 2026-09-12. **Zero releases behind.**

Upstream cadence, for calibration:

```
v0.15.0  2026-09-03
v0.15.1  2026-09-04
v0.15.2  2026-09-07
v0.15.3  2026-09-07
v0.15.4  2026-09-12   ← pinned
```

Five releases in nine days. This rules out "N releases behind" as a distance
metric — it would fire permanently. Distance is measured in **time**.

## What adopting a newer version costs

Re-pinning is not a version-number edit. It invalidates, in order of how easily
each is forgotten:

1. **The Contacts grant.** TCC binds to code identity. A rebuild is a new
   identity, so the grant obtained by the interactive prompt is gone, per
   product, and there are four class-R products. *(Unless the grant can be made
   to Node rather than to `imsg` — open, see the step3 plan.)*
2. **Class R itself**, which is defined by process — rebuilt under observation —
   not by a digest. Phase D runs again on both hosts.
3. **Every measurement**, which is evidence about a specific artifact.
4. **The `contact-batch` patch**, which is version-specific and may not apply.
5. **The audit set**, whose membership may change and must be re-derived.

## The asymmetry that sets the trigger

| Adopting | Cost |
|---|---|
| now — nothing deployed, nothing granted, nothing measured | ~zero |
| later — grant held, measurements taken, service running | high |
| never | slow, invisible, compounding |

**The cheapest moment to re-pin is always the earliest one.** So the check runs
at two moments, not one:

- at each Web UI code update, as the owner asked; **and**
- immediately before any irreversible investment — specifically **before the
  interactive Contacts grant**, since that grant is discarded by a rebuild.

## Outcomes

`current` · `defer(reason, expiry)` · `adopt`

**`adopt` triggers** — named in advance so each run is not a fresh judgement:

1. a security fix touching a path this project uses;
2. any change inside the audit set, meaning existing evidence describes code
   that has since changed;
3. a macOS compatibility fix relevant to either host's OS;
4. a change in patch applicability — it stops applying to the pin, or upstream
   absorbs it and it becomes unnecessary;
5. **distance: three months since the pinned release.**

**`defer` obligations:** a written reason and an expiry, **at most 90 days**.
Renewal is a new record, never a silent extension, so the number of renewals
stays visible.

## The check FAILS — loudly, non-zero — when

- **it could not determine the answer.** Network failure, tag parse failure, a
  change in upstream's API shape. "Could not look" must never render as "up to
  date". This is the specific bug being guarded against.
- **a path in the audit set no longer exists upstream.** The same bug in its
  original form.
- **the pinned commit no longer resolves upstream, or resolves to different
  content** — a moved tag or a force-push.
- **a previous `defer` is past its expiry.**

That last one is the mechanism. "Do not still be on an old version in three
years" is not enforced by intention; it is enforced by a check that starts
failing on day 91.

## To determine when writing it

Not assumptions — things to establish, since guessing them shapes the check:

- whether upstream publishes security advisories in any machine-readable form,
  or whether trigger 1 requires reading release notes by hand;
- whether upstream ever moves tags, which decides how strict the pin-identity
  check can be;
- who runs the check, and in which context, given that it reaches an external
  network service.
