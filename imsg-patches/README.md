# Patched imsg for imsg-web

The app runs a self-built `imsg` 0.15.4 with two local patches. A stock `imsg`
will not start under the app, because the app passes a flag only the patched
build knows.

| patch | apply to | what it does |
|---|---|---|
| `contact-batch/imsg-0.15.1.patch` | upstream `e2f5046` (v0.15.4); applies cleanly although it was written against 0.15.1 | resolves contact names per request in batches instead of one lookup per row; about 3× faster on the warm UI cycle, identical output on real data |
| `contact-source/imsg-0.15.4.patch` | the tree above | adds `imsg rpc --contacts-from-address-book` |

## Why the contact-source patch exists

Upstream reads the AddressBook store directly only inside an SSH session. Under
a LaunchAgent it uses Contacts.framework instead, where a self-built binary has
no grant, so no name resolves. The flag lets the caller pick the AddressBook
store. With Full Disk Access on the dedicated Node, names then resolve under a
LaunchAgent with no Contacts grant, and nothing needs re-granting after a
rebuild. Without the flag, behaviour is unchanged.

## Build (on the Mac)

```sh
git clone https://github.com/openclaw/imsg.git && cd imsg
git checkout e2f5046
git apply --check <repo>/imsg-patches/contact-batch/imsg-0.15.1.patch
git apply <repo>/imsg-patches/contact-batch/imsg-0.15.1.patch
git apply <repo>/imsg-patches/contact-source/imsg-0.15.4.patch
swift build -c release --product imsg --force-resolved-versions
```

Use the real file, `.build/out/Products/Release/imsg`; `.build/release` is a
symlink to it. Copy it into the release directory described in
`docs/operations.md`.

Swift 6.1.2 (Command Line Tools, Intel) resolves one more dependency than the
committed lock lists (`sqlcipher.swift` 4.19.0); Swift 6.4 does not. Both
builds worked.
