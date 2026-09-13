# Rebuild with the explicit contact source — both hosts (2026-09-13)

Both arms built on both hosts, from one archive, with
`experiments/contact-source/imsg-0.15.4.patch` applied to **both** arms so the
only difference between them remains contact-batch.

`imsg` was not executed. No real data was read.

| | |
|---|---|
| archive | `9938e03175bf17c2f9544d9ef13718d43b0d8f58ef993624ac1466410cd5b222`, 1,121,395 bytes |
| verified on both hosts | MATCHES |
| `RpcCommand.swift` across arms | byte-identical, as it must be |

## The four products that supersede the previous set

| | baseline | candidate |
|---|---|---|
| **M1** | `00983e9fee8df845b792b9287fa0bbdf09387cb2e26d625926c8eabe9950f7cc` (5,527,464 B) | `47794c680316f67a43c8b40a65bf1f605db576fc81f70269f903d03ad5292cc2` (5,554,424 B) |
| **Intel** | `f18c906ba9bd27f31fc5a904a77a789c865b75b9b68beb00cd86accb19404aa1` (5,540,264 B) | `fb78b375d986b2452a59e25817454e7b0114d0a99c458df1b4446365b78a16e4` (5,561,504 B) |

Each is 552–608 bytes larger than its predecessor, which is the size a flag
definition and one branch should add.

**The patch compiles.** That was the largest unverified claim in
`experiments/contact-source/README.md`, since Swift for macOS cannot be built on
the Linux workstation. It compiled on Swift 6.1.2 / CLT and on Swift 6.4 /
Xcode 27 beta, for x86_64 and arm64, in both arms — four independent
compilations.

The flag string appears twice in all four binaries, checked with `strings`
rather than by running them.

## The pin gate refused the Intel build, and it was right to

The first Intel attempt stopped at `pins-changed`, exit 73, on both arms.

```
pin count: 5 (expected 4)
pin count differs - the resolved graph is not the committed one
pin present: bd219c4e…  8ad83035…  15c27dbf…  964c300f…
```

All four required pins present; a fifth added — `sqlcipher.swift` 4.19.0 at
`39f212458aeb88e33bdac2200a793a3f0d55d32b`, the same revision as in the
historical 0.14.2 lock. This is the divergence Phase D reproduced from both
directions: Swift 6.1.2 resolves it into the graph and Swift 6.4 does not.

**The previous version of this gate passed here.** It checked only that the four
expected revisions were still present, which is why Phase D's Finding 2 recorded
that the graph gained a dependency while the gate said nothing. The bidirectional
version added in `8a1c312` refused. This is the first time that fix has been
exercised against the real case rather than a test.

### What was changed, and what deliberately was not

The gate was **not** relaxed to tolerate extra pins. That would hand back exactly
the blindness the fix removed.

Instead the generator gained `--expect-extra-pin <identity>@<40 hex>`, and the
Intel build **declares** the one package its toolchain adds. The gate then
requires that pin by identity *and* revision, and the expected count rises to
exactly five. An undeclared fifth pin, a declared one at a different revision, a
missing required pin, or a sixth still stop the arm.

Seven tests cover it, including a non-hex revision, an identity with no
revision, an uppercase revision and an identity carrying shell metacharacters.
Generator tests: 45 → 52.

## Consequences and residue

**The two hosts still build from different dependency graphs.** Phase D called
this the most consequential cross-host variable, and declaring it does not
remove it — it records it. Within-host baseline-versus-candidate, which is the
parity unit, is unaffected. SQLCipher is a `binaryTarget` and was not linked into
the previous products; whether that holds for these has not been re-checked.

**Build roots.** M1 built into `phase-d2`. Intel's first attempt left
`phase-d3`'s predecessor `phase-d2` behind at the point the gate stopped it —
extracted sources, resolved locks, no products — and the successful Intel build
used a fresh `phase-d3`. Nothing was deleted, per the standing rule, so the two
hosts' roots are named differently and Intel carries one abandoned root.

**The previous four class-R products still exist** under `phase-d` on both
hosts. They are superseded, not removed. `STATUS.md`'s digest table describes
them and now needs updating.

## Still not established

That the products run — none has been executed. That the flag does what it
says: compiling proves the branch exists, not that `--contacts-from-address-book`
reaches `allowingAddressBook`. That the AddressBook store is readable by these
binaries in any context. That question is unchanged by the rebuild and is what
the next rung is for.

## The product path traverses a SwiftPM symlink (found 2026-09-13)

Admission refused all four products with `ADMISSION_SYMLINK`, and it was right to.

```
.build/release -> out/Products/Release
```

`.build/release` is a symlink SwiftPM maintains. So the path used by every
phase so far — Phase D's digests, and every run in F, G0, H and I —

```
<root>/<arm>/.build/release/imsg
```

**is not a stable name for a file.** It names whatever `release` currently
points at.

What this does and does not affect:

- **The measurements stand.** The digests were taken of the bytes reached
  through that path, and the resolved file
  `<root>/<arm>/.build/out/Products/Release/imsg` has exactly the digest
  recorded for each arm. Nothing measured was a different file than reported.
- **The name was never pinned.** A later build of a different configuration
  would repoint `release`, and the same path string would then name different
  bytes. Nothing in this project would have noticed, because nothing checked
  the chain.

Admission now takes the **resolved** paths, and with those all three artifacts
(both products and the dedicated Node) are admitted. A deliberately wrong digest
is still refused in the same run, so the pass is not vacuous.

The general rule this is an instance of: checking a leaf with `stat` accepts a
target that a swapped parent can change. `lstat` on every component up to the
root is what catches it, and that is why the check walks the whole chain rather
than looking at the file alone.
