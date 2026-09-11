# Static measurement bundle verification — 2026-09-11

`scripts/nonlaunch-bundle.mjs` provides read-only `verifyBundle(root, manifest,
expectedDigest)`. No process is spawned, code imported from the bundle, manifest
generated, file changed, or live entry point supplied. This checks a complete
prepared file tree against an independently pinned inventory, not just imsg's
single executable. It is not yet connected to a launcher.

## Trust and manifest contract

The caller must obtain `expectedDigest` from reviewed packaging evidence outside
the bundle. Recomputing it from the presented bundle would defeat the pin. The
manifest is an array with one entry per file **and directory**, excluding the
private root itself. File entries have exactly `path`, `kind: "file"`, `mode`,
`size` (bytes), and lowercase hex `sha256`; directory entries have exactly `path`,
`kind: "directory"`, and `mode`. Parent directories must be explicitly listed.
Unknown fields, duplicate/unsafe paths and missing or unlisted entries fail.

The pinned digest is SHA-256 of UTF-8 JSON: entries sorted by relative path using
JavaScript string comparison, fields ordered path/kind/mode for directories and
path/kind/mode/size/sha256 for files. No whitespace or trailing newline. Root is
an absolute canonical path owned by the current UID with mode 0700. Ancestors
must be directories owned by root/current UID and not group/world writable,
except root-owned sticky directories. Caller must canonicalize macOS /tmp first.

Files may have mode 0600, 0644, 0700 or 0755, exactly as pinned; directories 0700
or 0755. Symlinks, nonregular files, multiple hardlinks, wrong ownership and mode
changes fail. The helper hashes through O_NOFOLLOW/O_NONBLOCK handles and checks
file identity before/after reading, directory identity before/after traversal,
and every entry again at the end. Directory entries and file bytes are streamed;
limits are 20,000 entries, depth 64, 256 MiB per file and 512 MiB total.
Failures expose only BUNDLE_REJECTED; success contains verified/files/bytes only.

## What it does not establish

- No atomic verify-and-execute guarantee. A same-UID writer or writable ancestor
  can still race later path resolution. The launch protocol must control bundle
  lifetime and revalidate near execution; these checks are not a sandbox.
- No source provenance, compiler reproducibility, runtime version, platform/arch,
  no-launch behavior or safe import graph attestation. The reviewed inventory
  must cover the intended application, dependencies, Node and imsg artifacts.
- No proof imports stay in-tree: launch environment (NODE_OPTIONS/NODE_PATH,
  loader flags), absolute imports and dynamic/native dependencies require review.
- npm `.bin` symlinks are intentionally rejected. A packaging plan must omit
  unused launch shims or explicitly materialize reviewed files; the verifier
  does not silently follow links or relax the policy to accept a working tree.
- No live artifact was approved. Outer process/listener watchdog and source audit
  remain separate gates; this helper cannot replace either.

## Verification

Six synthetic filesystem tests pass on Node 24.19.0, including complete inventory,
same-size content tampering, mode change, extra/missing entries, symlink root and
entries, an out-of-tree hardlink, rewritten manifest with unchanged pin, malformed
schema/paths and private-root rules. The sandbox presents `/` and `/tmp` as UID
65534, so the positive ownership test correctly rejected there; approved
unrestricted execution passed against the actual owners. An initial expected
fixture-byte-count assertion was corrected from 22 to 23, then all tests rerun.

Run `node scripts/nonlaunch-bundle.test.mjs`. git diff --check passes. No production
source/UI change, Mac access, full application suite, typecheck/build/browser run
or independent review in this additive-helper turn. Exact Node 24.20.0 is pending.

## Actual local staging check — 2026-09-11 follow-up

Built application sources at repository revision b089af5 (latest RPC source
change 7f699d3), then created a fresh private `/tmp/iw-app-stage.ZMQNP7`.
Copied package.json/package-lock.json and ran:

```sh
npm ci --omit=dev --ignore-scripts --offline --no-bin-links --no-audit --no-fund
```

The existing cache supplied 55 runtime packages without network, install scripts
or `.bin` links. Copied the freshly built dist tree into the stage. The staged
node_modules includes transitive dependencies and package-distributed auxiliary
files, not only entry modules. No source-repository dependency tree was pruned.

`scripts/inventory-bundle.mjs` now generates unapproved canonical inventory for a
controlled packaging directory; it is not a replacement for verifyBundle or a
race-safe scanner of an adversarial directory. It rejects observed links and
oversized/nonregular entries, emits approved:false, and never itself writes a
manifest or runs code. Two added tests bring the bundle suite to eight passing
tests on Node 24.19.0 in approved unrestricted execution.

Local stage self-consistency result:

- 2,189 regular files, 15,928,498 bytes, all entries accepted by verifyBundle.
- Inventory digest: `53c2e244f71c5df8d3efff6484d2da54738608fed8344766f7931cf2a7e9f4f1`.
- Inventory saved exclusively with mode0600 outside the stage at
  `/tmp/iw-app-stage.ZMQNP7.manifest.json`; it remains **unapproved**. Computing
  and checking the same inventory is packaging consistency, not independent
  artifact/source authorization.
- `/tmp/iw-app-stage-check.mjs` loaded Auth/createApp from staged dist and served
  staged web assets through in-process HTTP injection with synthetic ReadSource.
  Login, authenticated empty chats, and root HTML succeeded; sessions revoked
  to zero and app/source close awaited. No TCP listener or RPC child was needed.

Build and npm staging used available Node22.23.1; npm emitted the expected engine
warning for required24.20.0. Inventory verification and staged smoke used24.19.0.
These artifacts do **not** include an admitted Node executable or imsg binary,
are not Mac-specific deployment bundles, and do not establish Linux/Mac parity.
No full application/browser suite or independent review rerun in this follow-up;
build, eight bundle tests, staged synthetic smoke and diff check passed.

Preserved the stage, inventory and smoke script for inspection; nothing was
deployed, installed globally or published. Next: reviewed Mac packaging/runtime
and imsg provenance, then outer-process/listener supervision. Do not promote this
generated digest directly into a live trust pin without that review.
