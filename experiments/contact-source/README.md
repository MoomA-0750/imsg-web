# Explicit contact source

`imsg-0.15.4.patch` applies to upstream commit `e2f5046` (v0.15.4).

## What it does

Adds `--contacts-from-address-book` to `imsg rpc`, and a `forceAddressBook`
parameter to `ContactResolver.create`. Two files, 34 insertions.

## Why it exists

`ContactResolver.create` picks its contact source on one line:

```swift
let source = isSSH ? nativeSource.allowingAddressBook(at: AddressBookContacts.directory)
                   : nativeSource
```

`isSSH` is true only when `SSH_CONNECTION` or `SSH_CLIENT` is set. This
project's environment contract drops both, and a LaunchAgent is not an SSH
session either, so **both the measurement path and the production path take the
`CNContactStore` branch**, where a self-built binary is `.notDetermined` and
`canAttemptRead` is false. No name resolves.

Upstream's own comment says what the other branch is for:

```swift
// SSH can have Full Disk Access without a Contacts.framework grant. Read the
// existing v22 store in place, including its WAL; never copy or modify it.
```

That is exactly this situation — file access without a Contacts grant. The
branch was reachable only by inference from an environment variable, so a caller
that *knows* it has file access had no way to say so. The patch lets it say so.

## Why this rather than granting Contacts to the binary

A TCC grant binds to code identity. Four class-R products exist, and every
re-pin rebuilds them, so the grant would have to be re-obtained by desktop
prompt after each one — and the version policy adopted on 2026-09-13 has a
three-month distance trigger. This route holds no grant to lose. It also needs
no TTY stdin, so it does not require an exception to the non-TTY rule that
Phase F adopted as a structural guard against the Contacts prompt.

## Properties worth keeping true

- **Strictly no more prompting than before.** `useAddressBook` is a superset of
  `isSSH`, and the `requestAccess` guard tests `!useAddressBook`, so every case
  that did not prompt still does not.
- **Default behaviour is unchanged.** Without the flag, `forceAddressBook` is
  false and the expression reduces to the original.
- **No environment fabrication.** `SSH_CONNECTION` is neither set nor read
  differently; the decision is made by an argument.
- **A flag, not a valued option**, so there is no value to validate and no new
  failure path.

## Verification so far

- `git apply --check` passes on pristine `e2f5046`.
- `git apply --check` passes on the contact-batch candidate tree. The two
  patches touch different regions of `ContactResolver.swift` and contact-batch
  does not touch `RpcCommand.swift`.
- `CommandSignature(options:flags:)` exists with those labels and defaults
  (Commander); `.make(label:names:help:)` and `values.flag(label)` match the
  form `HistoryCommand` already uses.
- `RpcCommand.run` is called only from its own `spec`, so the factory signature
  change reaches no other caller. Every `ContactResolver.create` caller uses
  labelled arguments and the new parameter has a default.

**Not verified: it has never been compiled.** Swift for macOS cannot be built on
the Linux workstation, so everything above is static. Compilation is the first
thing a rebuild would establish, and a build failure is the expected way a
mistake here would surface.

Also unverified, and more important: **whether the AddressBook store is
readable by our binary at all** in either the SSH or the Agent context. The
patch selects a branch; it does not grant the file access that branch needs.
That is a separate question, and it is the one that decides whether this route
works.
