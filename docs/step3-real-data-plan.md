# Step 3 — real data, parity, and measurement

Status: **proposed. Nothing authorized, nothing executed, no real data read.**

Step 2 ended with four class-R products built under observation and exercised
against a synthetic database. Step 3 is where the owner's own `chat.db` and
address book are opened. That is a different kind of act from everything before
it, and the constraint from the handoff is still in force:

> 実データの読み取り … は、計画を私が承認してから着手します。

This document is the plan that authorization would be given to, not a request to
begin.

## What step 3 is actually for

The candidate arm exists for one reason: `experiments/contact-batch` changes
Contacts lookup for `chats.list` and `messages.history` from per-record to
request-local batching. Everything since has been infrastructure for asking two
questions about it:

1. **Parity** — does the candidate return the same chats, the same order, the
   same resolved names and the same message payloads as the baseline?
2. **C06** — is it fast enough, where the last recorded measurement was **Not
   met** on both hosts (warm p95 3,834 ms Intel / 5,282 ms M1 against release
   `a342425`, an artifact and workload this project may not reuse)?

Neither question can be answered without real data, because the thing under test
is contact resolution and a synthetic database has no handles to resolve.

### The consequence nobody should have to discover later

Phase F made `contacts.available: false` a **required** value and `true` a stop
condition, because the owner's address book is the owner's data.

**Step 3 inverts that.** A parity test that resolves no name tests nothing. So
step 3 necessarily enumerates the owner's contacts, and the protection changes
from *not reading* to *not retaining*: comparison happens on the Mac, and only
derived verdicts cross back. This inversion is the single largest change in
posture in the whole project, and it should be approved deliberately rather than
inherited from step 2's authorizations.

## The hazard step 2 handed forward

Phase D recorded that PhoneNumberKit's resource **directory** resolves, but that
a present directory with unreadable metadata is caught inside
`populateTerritories` and **continues silently with empty territories**. F2
could not see that, because a synthetic database normalises no numbers.

Parity alone is a weak instrument against it. The two arms have **separate
copies** of the bundle whose contents Phase D recorded as byte-identical
(`a9fcfe9e…`), so a degradation that is a property of the file's *contents*
degrades both identically and parity passes while the product is quietly broken.
Only a degradation in one copy's *metadata* would show up as a difference.

Step 3 therefore needs an **absolute** check alongside the relative one, and
"at least one name resolved" is not strong enough for it — see disposition N2.
A parity pass with no phone-derived resolution is a failure, not a pass.

## The ladder

Each rung is separately stoppable. No rung begins because the previous one
succeeded; each begins because the owner says so.

### G — the permission question, answered before anything is granted

Read-only. **Nothing is granted in G, and no real database is opened.**

Everything so far has assumed a self-built binary needs its own Full Disk
Access grant. The recorded history says something more specific: M1 LaunchAgent
access started working when the owner granted FDA to **the dedicated Node
executable**, not to `imsg`. And F2's TCC lines were attributed to
`com.apple.sshd-keygen-wrapper` — the session's responsible process, not the
binary that made the call.

So the question "what must be granted, and to what" is **open**, and the answer
determines whether the owner is asked to grant anything at all:

- which code identity TCC attributes a `chat.db` read to, in each of the three
  contexts that matter — an SSH shell, a LaunchAgent-started Node spawning
  `imsg`, and a direct invocation;
- whether responsibility attribution means an already-granted Node confers
  access on the `imsg` child it spawns, regardless of that child's identity;
- what grants already exist, reported **by name only, never by value**, as
  agreed for the GUI-domain environment.

G is reading and log inspection only. Its output is a written statement of what,
if anything, the owner would have to do by hand — and a grant the owner makes is
a change to their system that this project will not make for them, will not
automate, and cannot undo.

**If G shows no new grant is needed, the plan gets simpler and the owner is
asked for nothing. That is a possible outcome and should not be assumed away.**

### H — one real read, narrowest possible

`status` against the real `chat.db`. It opens the database and reports readiness;
it returns no message and no chat.

This rung exists to separate two failures that would otherwise arrive together:
"cannot open the owner's database" and "opens it but reads it wrongly". F2
already demonstrated how badly a conflated version reads — an error naming Full
Disk Access that was actually a WAL fixture I had built wrong.

Two live conditions H must record rather than assume:

- **WAL.** The real `chat.db` is WAL, and its `-wal`/`-shm` sidecars are live
  because Messages runs. A read-only open without the shared-memory file
  **fails**. Whether Messages is running is therefore part of the measurement
  condition, not background detail, and it is recorded at every rung.
- **The Intel bridge.** Intel's ready lock is present and belongs to the dylib
  injected into a running Messages.app. `status` on a present lock performs
  IPC, with a 0.14.2 bridge against our 0.15.4 product — a protocol pair whose
  behaviour is **not established**. H does not run on Intel until that is
  decided separately, exactly as F2 did not.

### I — parity, compared without moving the data

Baseline and candidate, **same host, same toolchain, same product pair**, over
`chats.list` and `messages.history`.

Cross-host comparison is not parity: the two hosts differ in architecture, OS,
Swift version **and resolved dependency graph** (Intel's older SwiftPM pulls in
SQLCipher; M1's does not). Within-host baseline-versus-candidate is the only
comparison where a difference has one candidate cause.

The comparison runs **on the Mac**. What crosses back is a verdict, not content.

**A single digest is the wrong instrument.** It answers one bit, and a mismatch
leaves nothing to debug without going back for a closer look at the owner's
data — which is the one thing this design is trying to avoid needing twice. The
comparison is therefore tiered *in advance*, so a mismatch localises itself:

1. per-response digest (equal / not equal);
2. on mismatch, per-record digests → **which record positions** differ;
3. on mismatch, per-field digests within those positions → **which field names**
   differ.

Field **names** and **positions** cross back. Field **values** never do. That is
the same rule already agreed for the GUI-domain environment, applied to data.

Alongside it, the absolute checks parity cannot provide: at least one handle
resolves to a name; record counts are non-zero; ordering is stable across
repeated reads of an unchanged database.

### J — C06 measurement

Only after I passes. Measuring an arm that returns different answers measures
nothing worth having.

C06 is warm API-cycle p95 and RSS over the defined 20-sample / 30-minute window,
through the actual application, not through `imsg` directly. The harness for it
is **not finished**: `scripts/nonlaunch-api-session.mjs` is documented as "a
one-cycle owned-resource runner, not the complete live supervisor" — no artifact
admission, no startup supervision, no OS-signal wiring, no outer watchdog. That
gap is step 3 implementation work on this workstation, with synthetic data, and
it is not a Mac activity.

The historical numbers are **not a baseline**. They came from release `a342425`
and its old CLI-injected workload, which `AGENTS.md` forbids reusing or
repointing. Step 3 measures from zero and does not relabel old timings.

### Not in this plan

Production deployment. Tailscale Serve. Any write to the Messages database or
any bridge. Sending, read-state or typing. `git push`. The limited trial, which
is step 4.

## What has to be built before any of this runs

- **A fourth generator.** Real-data execution is a fourth contract: it may open
  one specific protected path, must write nothing, and must run a bounded number
  of times. The Phase A, D and F generators are each narrower in a way that
  matters, and none may be widened to cover this — widening one retroactively
  weakens everything it has already signed off.
- **The nine deferred Phase D generator holes**, which were recorded to be
  closed "before the next template revision". This is that revision: unchecked
  `cd` destination, unconstrained `xcrun`, `PATH=` reassignment, process
  substitution, `tar` create mode, `--cache-path=VALUE` form, multi-argument
  `mkdir`/`touch`, `find -fprint`, trailing `&`.
- **The comparison tooling**, written and tested against synthetic data here,
  before it ever sees a real record.
- **The C06 supervisor**, per above.
- **The standing "is there a newer imsg?" check.** The owner asked for a
  re-check at each Web UI update, motivated by not sitting on an old version
  years later. It is not written yet, and it has to be written as a check that
  **can fail** — a procedure that always reports "fine" is the vacuous
  verification this project has already made once, in the "all nine files
  byte-identical" check where four of the nine paths did not exist.

## Stop conditions

- Any dialog on the desktop, or any TCC denial in the unified log.
- Any value leaving a Mac that is not a count, a name, a digest or a verdict.
- `contacts.available: true` on any rung before I, where it remains a stop
  condition.
- A parity pass with zero resolved names — a pass that proves nothing is a
  failure.
- Any modification to `chat.db`, its sidecars, the bridge, or Messages state.
- Any interaction with the Intel bridge that has not been separately decided.
- Any measurement taken under a Messages-running state different from the one
  recorded for the arm it is compared against.

Uncertainty stops the rung. Nothing is cleaned up automatically.

## What step 3 will not establish

That the product is safe to deploy — that is step 4 and the C0x gates, most of
which remain pending. That rollback to a different version works. That the
stock and self-built binaries agree, since they are different versions and only
within-host, same-version arms are compared. That a grant made for this
measurement should persist afterwards; whether to remove it is the owner's
decision and this project will not make it.

---

## Review scope for this plan

- Is the ladder in the right order, and is G genuinely read-only, or does
  establishing TCC attribution require an access attempt that is itself the
  thing being authorized?
- Does the tiered comparison actually keep values on the Mac, or does "which
  field names differ" leak content by implication — for example when a field
  name is itself derived from data, or when the set of differing positions is
  small enough to identify a conversation?
- Is "at least one name resolves" sufficient as the absolute check for the
  PhoneNumberKit metadata hazard, or can empty territories still produce a
  resolution that looks correct?
- H runs `status` on the real database. Is `status` genuinely narrower than the
  alternatives on the code paths it takes, or does it reach something else on
  the way — as it did in Phase F, where `--db` moved the database but `status`
  still stat'd the Messages container?
- Is within-host baseline-versus-candidate the right parity unit, and does
  anything make the two arms non-comparable even on one host?
- What in this plan is a claim rather than an observation, and what would it
  take to make it observable before it is relied on?
- What does this plan not stop on that it should?

---

# Review dispositions (F5)

Five blockers and eight further findings. **The plan above is not runnable as
written** — B1 is a defect in the plan's central premise, not in its wording.

Every claim adopted below that could be checked against the pinned v0.15.4
source was checked before adoption, because a review is not a test.

## B1 — Adopted. Under this project's own environment contract, no name can resolve

The plan's absolute check asks that at least one handle resolve to a name. On
the pinned source that is **unreachable**, for a reason this project created.

`ContactResolver.create` chooses the contact source on one line:

```swift
let isSSH = environment["SSH_CONNECTION"] != nil || environment["SSH_CLIENT"] != nil
…
let source = isSSH ? nativeSource.allowingAddressBook(at: AddressBookContacts.directory)
                   : nativeSource
```

- **`isSSH` is false**, because the Phase C allow-list drops both variables. So
  the AddressBook SQLite fallback — the branch that maps `.notDetermined` to
  `.addressBook` and reads the address book as *files* — is not taken.
- The remaining path is `CNContactStore`, and a self-built binary is
  `.notDetermined`. `canAttemptRead` is `self == .authorized || self ==
  .addressBook`, so `.notDetermined` returns early with **`unavailable: true`**.
- `requestAccess` is reachable only with TTY stdin, which F2 and F3 forbid and
  which production does not have either.

So `contacts.available` is `false` and **zero names resolve**, on both hosts,
for both arms. The historical record agrees: the only run that ever resolved
names (15, on M1) did so under an *inherited real SSH environment*, and Intel
resolved 0 even then.

**The consequence is larger than the rung.** The production LaunchAgent is not
an SSH session either, so `isSSH` is false there too. The candidate patch
batches Contacts lookups — in a configuration where there may be no Contacts to
look up. **Whether the patch's benefit is realisable in the intended production
configuration at all is now an open question**, and it is prior to measuring it.

Fabricating `SSH_CONNECTION` to take the fallback branch is not available: Phase
C explicitly forbids it.

**Owner decision required, before H.** Three options, no recommendation smuggled
into the ordering:

- **(a)** Allow one deliberate interactive grant: run once with TTY stdin so
  `requestAccess` fires, accept the prompt at the desktop, and thereafter the
  binary is `.authorized`. This is a real permission entry for a self-built
  binary, per code identity — and there are **four** class-R products, so it may
  be four grants, not one.
- **(b)** Re-examine the environment contract for the Agent context
  specifically. This reopens a decided matter and should not be done casually.
- **(c)** Accept that step 3 measures the no-contacts path only, and record that
  the candidate patch is unmeasured rather than measured-and-equal.

A further **unverified** point from the review, which I could not check from
here and which matters to (a): macOS's Contacts privacy pane may not allow
adding an arbitrary binary by hand, only listing applications that have already
requested. If that is so, (a)'s prompt is the *only* route, and (c) becomes the
fallback rather than a preference.

## B2 — Adopted. The grant is a state transition and needs its own rung

H requires `contacts.available: false`; I requires `true`. A grant in between
invalidates H's evidence for the post-grant state, and the plan had no rung
where the transition happens.

Confirmed from source, with one correction to the review's phrasing: `status`
enumerates the address book **only once authorized**. Before that,
`snapshot(region:)` returns at the `!canAttemptRead` branch and loads nothing.
After that, reading `contacts.available` alone reaches `loadCatalog()` →
`loadRecords` → `store.enumerateContacts`, fetching **every contact's name,
phone numbers and email addresses** into memory.

**Adopted:** the grant becomes its own rung with its own authorization, and the
plan states plainly that a post-grant `status` — a call that returns no chat and
no message — **loads the entire address book**. The sentence "it opens the
database and reports readiness" was true about the response and misleading about
the process. That is the same error shape the plan itself cites: `--db` moved the
database while `status` still stat'd the container.

## B3 — Adopted. Raw responses would be written to files and then deliberately kept

The F2 template pipes the product's stdout straight to the script's stdout, and
this project's execution model redirects that to a file. Point `chats.list` or
`messages.history` at the real database through the same shape and message
bodies, recipients and identifiers land in a file — which the standing rule
"nothing is cleaned up automatically" then keeps indefinitely, outside the
protection TCC gives the database it came from. Stderr is not discardable either,
by generator rule, so values inside error text travel the same way.

The earlier comparison work was explicit that no body, address, chat ID, name or
HMAC value was persisted. This plan said "not retaining" and did not implement it.

**Adopted, into the fourth generator's contract:** the product's stdout is piped
directly to the on-Mac comparator and **never written to a file**; no raw
response byte is written anywhere; the comparator's own output is verdicts only.
New stop condition: *any raw response byte reaching a file*.

## B4 — Adopted. Exported digests are reversible over low-entropy fields

Unkeyed SHA-256 of a phone number (~10^10), a boolean, a timestamp or a short
display name is a dictionary attack, not a one-way function. The plan explicitly
permitted "a digest" to leave the Mac.

**Adopted:** digests do not leave the Mac. What leaves is the verdict, position
indices, and field names **from a fixed allow-list fixed in advance**; anything
off the list is reported as `unlisted`. Where a digest is genuinely needed for
comparison it is HMAC'd with a key generated per run and never persisted, as the
earlier comparison work did.

The stop condition's "a name" was ambiguous between *field name* and *contact
name*. Corrected to "a field name from the fixed list, or a grant name".

## B5 — Adopted. H/I and J run in different contexts, and the plan named none

Verified here: the application spawns `imsg` with **no `--db`**
(`readonly-client.ts` passes `['rpc']`), so the child resolves
`MessageStore.defaultPath` from its own `HOME` — the Phase C `passwdHome()` —
and the app then *checks* the reported path. The F-shaped rungs instead run under
`env -i HOME=<private>` with an explicit `--db`.

So I and J would not be observing the same database resolution, the same bridge
lock, the same Contacts source or the same responsible process (sshd vs. Node).

**Adopted:** a table fixed before G, of rung × host × arm × launch context ×
`HOME` × responsible process × expected `database.path`. Also adopted: J's
prerequisites were incomplete — a LaunchAgent-context measurement needs Agent
installation and execution of the FDA-granted dedicated Node, both of which
require their own owner approval under `AGENTS.md` and neither of which was
listed.

## N1 — Adopted. G cannot produce its output by reading alone

Enumerating existing grants means reading the TCC database, which is protected by
the very permission in question; and attribution does not appear in the unified
log without an access attempt. F2's attribution evidence came from *running*, not
from reading.

**Adopted:** every line of G's output is labelled `observed` or `inferred`; the
first actual attribution observation is part of H and appears in H's written
predictions; "enumerate existing grants" becomes the owner reading the Privacy
pane, not me reading a database.

## N2 — Adopted, and the plan's own wording was wrong

Two things:

- "Both arms share the same bundle" is **inaccurate**. Phase D recorded separate
  per-arm copies with identical content digests. Corrected in the body above; the
  hazard mostly survives the correction, but not in the form stated.
- "At least one name resolves" is too weak: an email handle resolves without
  going through phone-number normalisation, so an empty-territory bundle can
  still produce a resolution that looks correct.

**Adopted:** the absolute check becomes four-valued — contacts unavailable /
available but zero resolutions / **≥1 resolution from a phone handle** / email
handles only — and only the third is a pass. Each arm's own
`PhoneNumberMetadata.json` is stat'd and digested at run time rather than trusted
from Phase D.

## N3 — Adopted. "Unchanged database" and "Messages running" contradict each other

The plan needs Messages running for the WAL sidecars, and needs the database
unchanged to compare ordering. One incoming message breaks the second.

**Adopted:** arms run **ABBA**, and `chat.db-wal`'s size and mtime are `stat`'d
immediately before and after each arm. A pair that straddles a change is
**inconclusive** — neither pass nor fail — and is discarded. Added as a stop
condition too.

## N4 — Adopted. "No modification to chat.db or its sidecars" fires constantly

Messages writes continuously; the stop condition as written is either
unobservable or always true.

**Adopted:** restated as an observation of the product's own file descriptors —
opened read-only, verified with `lsof` — with sidecar movement expected and
attributed to Messages. `lsof` must be added to the fourth generator's
allow-list; the Phase F allow-list has no such command.

## N5 — Adopted. Position-based comparison collapses on a count difference

One inserted record shifts every later position, so the localisation step fails
exactly when it is needed, and the set of positions leaving the Mac grows to the
length of the response.

**Adopted:** stage 2 aligns by a stable key **on the Mac** and reports
"inserted/missing at position k". The alignment key itself never leaves.

## N6 — Adopted in full. Missing stop conditions

Added: grant state changing between the two arms of a pair or between rungs; any
change in Intel's foreign watcher or agents, and any residue from our own
process; any file appearing outside the private directory, including IPC
inbox/outbox counts and mtimes and a `.ips` crash report (whose argv would carry
the real `--db` path); the Phase F rules that were dropped — "no response within
the bound is defined as a possible prompt" and the owner checking the Privacy
pane after each rung; `database.path` not matching the expected real path; and a
response exceeding the size bound or carrying error text.

## N7 — Partly adopted; two items are owner decisions

Adopted: per-arm grants; J's launch-context prerequisites (B5); counterbalancing,
which `nonlaunch-api-workload.md` lists as an outstanding C06 gate and which the
plan omitted. Confirmed and merely to be stated: the Web path never uses the CLI
`status` route — `cliStatus` is reached only from `doctor.ts`.

**Owner decision — Intel.** There is no rung for deciding the Intel bridge, so as
written I and J are M1-only. The intended production host is the iMac. Measuring
only the M1 and deploying the Intel is a gap that should be accepted explicitly or
closed with a rung, not discovered at step 4.

**Owner decision — the standing version check.** If it finds a version newer than
0.15.4, what happens? Re-pinning invalidates all four class-R products and the
work built on them. Freezing at 0.15.4 contradicts the motivation for asking for
the check. This needs an answer before the check is written, or the check will be
written to produce whichever answer is convenient.

## N8 — Adopted. Claims separated from observations

The review's table is adopted, with three entries resolved here by reading the
pinned source rather than leaving them open:

| Statement | Status now |
|---|---|
| `status` returns no message and no chat | **Confirmed** for the response; **corrected** for the process — see B2 |
| Both arms share the same bundle | **Wrong**; separate copies, identical contents. Corrected above |
| FDA was granted to Node, not to imsg | **Half true**: the record says Node was granted; it does not say imsg was not |
| The real `chat.db` is WAL | Still **inferred**. Observable by listing the container's sidecars |
| Same host ⇒ one candidate cause for a difference | **Overstated**; code identity, bundle copy, run order and database drift remain |
| `homeDirectoryForCurrentUser` honours `$HOME` | Still **undetermined**; resolved by H's `database.path` check |

## Rejected

Nothing. Every finding is adopted, adopted with a correction, or routed to the
owner as a decision I should not make.

## What this means for the plan's status

B1 is not a wording defect. Until the owner decides between (a), (b) and (c),
**there is no version of rung I that can pass its own absolute check**, and
rungs G and H would be gathering evidence for a measurement that cannot be
completed. The plan does not proceed to any rung before that decision.

---

# Owner decisions, 2026-09-13

## B1 → **superseded: the explicit-source patch, not the interactive grant**

The owner first chose (a) and then, after the comparison below was laid out,
chose the patch route instead. **The patch supersedes (a).** No Contacts grant
will be requested, and no rung runs with TTY stdin to provoke a prompt.

The patch is `experiments/contact-source/imsg-0.15.4.patch`: a
`--contacts-from-address-book` flag on `imsg rpc`, applying cleanly to both the
pristine tree and the contact-batch candidate tree. It has never been compiled.

Consequences of the change of route:

- Phase F's non-TTY rule stays a rule. Nothing needs an exception to it.
- No grant exists to be destroyed by a re-pin, which removes the interaction
  between the version policy's three-month trigger and the Contacts prompt.
- The class-R product set must be rebuilt with the patch, on both hosts, before
  any parity or C06 work. The four digests recorded in `STATUS.md` describe
  products that will be superseded.
- **The open question moves.** It is no longer "will the owner be prompted" but
  "is the AddressBook store readable by our binary in the context the
  measurement runs in". The patch selects the branch; it does not grant the file
  access the branch needs.
  — **Answered 2026-09-13, in both contexts.** H1: `true` over SSH, with a
  control arm returning `false`. H2: `true` under a LaunchAgent, launchd →
  dedicated Node → `imsg`, with the responsible process observed as `node`
  rather than sshd. See `docs/step3-h1-result.md`, `docs/step3-h2-result.md`.

The record of (a) is kept below because the reasoning that led away from it is
the useful part.

## B1 → (a), one deliberate interactive grant *(superseded, see above)*

One run with TTY stdin so `requestAccess` fires, and the prompt is accepted at
the desktop. Consequences that follow from the choice rather than from the
plan, and that are therefore recorded here rather than argued again later:

- The grant attaches to **code identity**, so it is per product. There are four
  class-R products. It may be four prompts, not one.
- Any rebuild — including adopting a newer upstream `imsg` — produces a new
  identity and **discards the grant**. See the version-check policy.
- This is the one rung that deliberately violates the non-TTY rule that Phase F
  adopted as a structural guard. It therefore gets its own generator contract,
  its own authorization, and is never combined with another rung.

## N7 Intel → measure on M1, deploy on Intel, **conditional**

Accepted by the owner *provided the final artifact runs on both Intel and Apple
Silicon*. **That condition is not currently satisfied**, and the plan must not
record it as if it were:

Intel has executed `--version` and nothing else. F2 and F3 were skipped there
because the bridge ready lock is present. So on Intel this project has never
observed the RPC server start, the database open, the resource bundle resolve,
or the process terminate.

### The question that decides whether Intel can be exercised at all

The ready lock is resolved through **`NSHomeDirectory()`**
(`MessagesLauncher.swift`), while the default database path uses
**`FileManager.default.homeDirectoryForCurrentUser`** (`MessageStore.swift`).
Two different APIs, and whether either honours `$HOME` is undetermined — item
N8, still open.

It decides everything about Intel. The F rungs run under `env -i HOME=<private>`:

- **If `$HOME` is honoured**, the product looks for the lock under the private
  root, finds nothing, reports `bridge.ready: false`, performs no IPC — and
  Intel F2/F3 are safe to run without ever approaching the foreign bridge.
- **If it is not**, the product finds the real lock and performs IPC with the
  0.14.2 dylib injected into a running Messages.app. That is exactly what was
  refused.

F2 on M1 could not discriminate: the lock was absent from both the real home and
the private root, so both hypotheses predict the observed result.

### A discriminating experiment that touches no real bridge

On **M1**, which has no bridge and no foreign system: create a decoy container
under the private root, containing a `.imsg-bridge-ready` file, and run the F2
shape against it.

`bridgeSnapshot()` distinguishes the two outcomes by error string:

- not looked at the private root → `.unavailable` → *"The bridge is not started.
  Run imsg launch explicitly before using bridge methods."*
- looked, found the decoy, attempted IPC, timed out → `.probeFailed` → *"The
  existing bridge did not answer a non-launching status probe."*

Every write is inside the private root, the IPC attempt is against a directory
this project created, and the host has no bridge to disturb. It converts an
undetermined claim into an observation before anything depends on it, which is
the pattern that has worked in every phase so far.

A second, weaker signal is available at no cost: run the F2 shape **without**
`--db` and read back the reported `database.path`. That probes
`homeDirectoryForCurrentUser` rather than `NSHomeDirectory()`, so it does not
answer the lock question — but a disagreement between the two would itself be a
finding.

## Contact sources — why an external binary is not one

Asked whether adding a separate tool could supply contacts instead of granting
Contacts to `imsg`. Checked against the pinned source rather than reasoned about.

**There is no injection point.** `imsg` resolves names inside itself, and the
source is chosen on one line with no override:

```swift
let source = isSSH ? nativeSource.allowingAddressBook(at: AddressBookContacts.directory)
                   : nativeSource
```

No environment variable, option or file lets a caller supply contacts. The
grep for `IMSG_*` finds overrides for bridge IPC, launch timeout and version —
none for contacts. So an external tool's output has nowhere to go, and a
measurement taken against externally-supplied names would be measuring
something other than the candidate patch, whose entire content is *`imsg`'s own
batching of its own lookups*. It does not solve the problem it appears to solve.

Independent of that, adding a third-party binary would: reintroduce exactly the
provenance uncertainty class R was built to remove; need its own TCC grants, so
it duplicates the prompt rather than avoiding it, onto a less-audited artifact;
and, if it reaches Apple over the network, introduce credentials — a class of
secret this project has kept out of argv, environment, logs and chat entirely —
while returning server-side data that need not match what Messages resolves
against locally.

## The option the upstream source itself points at

`AddressBookContacts` carries this comment:

```swift
// SSH can have Full Disk Access without a Contacts.framework grant. Read the
// existing v22 store in place, including its WAL; never copy or modify it.
```

So upstream built the AddressBook fallback for **precisely this situation**: a
process with file access but no Contacts grant. It needs **no Contacts grant at
all** — only file access, which the dedicated Node already holds.

It is gated on `isSSH`, and Phase C forbids fabricating `SSH_CONNECTION`. But
that prohibition is about *fabricating an environment variable*, and there is a
way to reach the same branch without doing so:

**A second local patch making the contact source explicit** — e.g. a
`--contacts-source` option selecting the AddressBook reader directly, instead of
inferring it from SSH variables. Applied to **both arms**, so within-host parity
is unaffected.

| | (a) interactive grant | explicit-source patch |
|---|---|---|
| desktop prompt | required, per code identity | none |
| survives an `imsg` rebuild | **no** — grant dies with the identity | **yes** — no grant involved |
| number of grants | up to 4, one per class-R product | 0 |
| relies on | a Contacts grant to `imsg` | file access the dedicated Node already has |
| cost | none to build | a second patch to write, review and maintain |
| environment fabrication | none | none |

This is **not** a recommendation to overturn (a); it is a second option the
owner did not have when choosing, surfaced because the source made it visible.
It also interacts with the version policy: option (a)'s grant is destroyed by
every re-pin, and the patch route has no grant to destroy.

## A question this raises about production, not about measurement

The production LaunchAgent is not an SSH session either, so `isSSH` is false
there too and the same code path applies. **It is therefore possible that the
deployed UI has never resolved a contact name**, and no record states otherwise:
the C02 Agent runs recorded chat and message counts, not whether names appeared.
The only run that ever resolved names did so under an inherited real SSH
environment, and resolved 0 on the Intel host even then.

If that is so, (a) is not a measurement convenience — it is a **production
defect being discovered**, and the choice between the two routes above is a
product decision rather than a testing one.
