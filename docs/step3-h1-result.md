# Step3 rung H1 — the flag works (2026-09-13)

M1 only, with owner authorization covering the fact that a `true` result means
the owner's address book was read.

Two arms, differing by exactly the flag. A generator test asserts that: it
generates both and requires the run lines to be equal after removing the flag.

| | control (`auto`, no flag) | treatment (`--contacts-from-address-book`) |
|---|---|---|
| `contacts.available` | **`false`** | **`true`** |
| product exit | 0 | 0 |
| address book directory | readable | readable |
| fixture digest before / after | unchanged | unchanged |
| address book listing before / after | identical, 8 entries | identical, 8 entries |
| process count before / after | 610 / 610 | 609 / 609 |
| TCC lines naming `imsg` | 7 | 20 |
| of those, any denial | **0** | **0** |

**The control arm is what makes this readable.** `true` alone would not
distinguish a working flag from an address book that was always going to be
available; `false` alone would not distinguish a broken flag from an unreadable
store. The pair does both.

## What was read

`status` returns only `contacts.available`, a boolean. Reaching it calls
`ContactCatalog.snapshot()`, which on a readable source runs `loadCatalog()` →
`AddressBookContacts.load` and brings **the whole address book** — names, phone
numbers, email addresses — into the process. `true` therefore means it was read.
None of it was emitted, none of it was written, and the directory listing is
byte-identical before and after.

## Why it worked without any grant, and what that does not prove

Every one of the 7 and 20 TCC lines naming `imsg` is an `AUTHREQ_ATTRIBUTION`
record, and **not one line mentions both `imsg` and a denial**. The services
appearing are `kTCCServiceAddressBook`, `kTCCServiceSystemPolicyAllFiles` and
`kTCCServiceDeveloperTool`; the AddressBook ones are all `AUTHREQ_CTX` context
entries, not verdicts.

The responsible process in every attribution is **`com.apple.sshd-keygen-wrapper`**,
not `imsg`. That is the attribution question rung G was meant to answer, now
observed rather than inferred: TCC attributes to the session leader, and the
file access came from the SSH session, exactly as upstream's own comment
predicts —

```swift
// SSH can have Full Disk Access without a Contacts.framework grant.
```

Note that `isSSH` inside the product was **false**: the run used `env -i`, so
`SSH_CONNECTION` was not in the child's environment. The process was still a
descendant of sshd, which is what TCC attributes on, but the product's own
branch was chosen by the flag. That separation is precisely what the patch was
for, and the control arm returning `false` under the same process ancestry is
the proof that it is the flag doing the work.

**This proves the flag works under SSH. It does not prove it works under the
LaunchAgent**, where the responsible process would be the dedicated Node rather
than sshd. Node holds Full Disk Access per the deployment record, so the
mechanism is plausible — but plausible is what this project has repeatedly
found to be wrong, and it is not established. That is the next question, and it
is a different rung.

## Consequences

- **The contact-source route is viable.** No Contacts grant was requested, no
  prompt appeared, no TTY was needed, and nothing needs re-granting after a
  rebuild.
- **The candidate patch now has something to measure.** `contact-batch` batches
  contact lookups; until this rung there was no configuration in which any
  lookup resolved, so parity would have compared two arms that both resolved
  nothing.
- **The open production question is sharper.** It is no longer "has the deployed
  UI ever resolved a name" in the abstract; it is "does attribution through Node
  behave as it does through sshd".

## Residue

Under `step3-h1`: two run scripts, the fixture copy, an empty `tmp`. The address
book was read and not modified. Nothing was deleted.
