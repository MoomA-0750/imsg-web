# Source/runtime pre-admission checkpoint — 2026-09-12

Step2 progress, not permission to execute imsg or a Mac deployment. Lead static
inspection only; no independent approval of this audit, native build, message
read, Mac access, runtime replacement or permission change occurred.

## Recovered fixed sources

The former /tmp/imsg-web-p0c.I5dOU7 source checkouts and local24.20.0 runtime were
not present. Fresh upstream Git clone and detached worktrees were created under
`/tmp/imsg-source-audit.6kjPXK/` (upstream, v0142, v0151). No upstream code was run.
Both upstream AGENTS.md files were read before preparing the worktrees.

- [0.14.2 commit](https://github.com/openclaw/imsg/tree/c99e6d0b4b996275c7bc3d696010d59f6e07a588)
- [0.15.1 commit](https://github.com/openclaw/imsg/tree/646ea7af9616dc3e6406d86aa269bf4fb1b07a76)

Stored contact-batch patches pass git apply --check against their exact commits;
neither patch was applied or built. Patch SHA256:

- 0.14.2: d32cad5e1b99c34f8ce981be38cfc28889ec4f0c4f619dd0e0e36018500f8700
- 0.15.1: 6715e27a40fa5d47a0e9245a5f6f197fc59cb5754d95c0e7c9d6870c9f187b65

Changed paths are ContactCatalog, ContactResolver, RPCServer+Handlers and two
tests only. They do not patch RpcCommand, RPCServer constructors, status handlers,
MessagesLauncher, bridge client or MessageStore. Applicability is not source-to-
binary proof: previously measured Mac release digests still need fresh matching.

## Confirmed default call paths (both fixed versions unless noted)

1. RpcCommand creates Contacts resolver with forStdin policy. Pipe/non-TTY selects
   skipIfNotDetermined, so the explicit requestAccess branch is not entered. The
   helper creates a native store and notification observer; this is not proof
   that the OS can never display UI during permission transitions.
2. RPCServer(databasePath:...) stores action closures rather than invoking them.
   Its default bridge closure uses invokeWithoutLaunching and readiness checks
   only the ready-lock file. MessagesLauncher initialization resolves an existing
   helper path with fileExists; it does not launch or inject it.
3. statusSnapshot joins databaseResources.snapshot and bridgeSnapshot, then reads
   Contacts availability. Database resource recovery reopens read-only handles
   after identity changes (up to2 attempts); it does not create/repair chat.db.
   MessageWatcher initialization stores references; stream polling starts only
   when explicitly requested, which this API workload does not do.
4. MessageStore uses SQLite URI mode(readOnly) plus readonly:true. Schema discovery
   reads table metadata. Version0.15.1 additionally registers imsg_search_text
   with sqlite3_create_function_v2 on the connection, not a persistent DB schema
   update. This does not establish absence of SQLite WAL/SHM/OS bookkeeping.
5. invokeWithoutLaunching refuses legacy IPC and absent ready lock. Unlike invoke,
   it never calls ensureRunning/ensureLaunched or invokeLegacy. Existing-ready
   status uses invokeV2: creates inbox/outbox if needed, publishes UUID request
   files and reads/removes protocol files. **Non-launching is not zero filesystem
   writes.** Receiver/dylib binary behavior remains an artifact/admission boundary.
6. RPC bridge event-path usability uses lstat/access only, not subscription or
   event-file creation. The canonical HTTP workload does not invoke bridge
   mutation handlers, watch, send, attachment conversion or CLI status.

RpcCommand, RPCDatabaseResources, RPCServer+StatusHandlers, IMsgBridgeClient and
MessagesLauncher files compare identical across the two commits. Inspected
support: BridgeHelperLocator, MessageWatcher initializer, ContactResolver,
ContactCatalog, MessageStore/Schema/Search, RPCServer constructors/Handlers and
AddressBookContacts. This is a bounded source audit, not full native dependency
or injected-helper verification. Existing DB/history parity results remain
historical and are not relabeled as current API correctness evidence.

## Launch-environment finding

0.15.1 ContactResolver.create checks SSH_CONNECTION/SSH_CLIENT presence and permits
an AddressBook SQLite fallback only for SSH. AddressBookContacts opens readonly,
selects existing v22 stores and invalidates unavailable/migrated sources. Therefore
blindly clearing all environment variables changes the effective contact source;
SSH timings/name parity cannot be claimed to represent a LaunchAgent environment.

The future trusted worker must use explicit reviewed environment/cwd and direct
absolute Node/imsg entrypoints, not inherited arbitrary NODE_OPTIONS/NODE_PATH,
loader flags or DYLD injection overrides. It must explicitly distinguish actual
SSH versus Agent context; do not fabricate SSH flags to force names to appear.
ReadonlyRpcClient currently inherits its parent's environment. No new production
option or permission bypass was introduced here. HOME/cwd, native dylib loading,
Node import closure, IPC side effects and source permissions must be recorded
before admitting a launcher. Do not use doctor or historical a342425 diagnostics.

## Node24.20.0

Re-read the [official checksums](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt).
Historical Darwin tar.gz hashes still match:

- x64: 9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4
- arm64: 40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8

Downloaded Linux x64 tar.xz into the audit directory; SHA256 equals official
2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2 before extraction.
Executable: /tmp/imsg-source-audit.6kjPXK/node-v24.20.0-linux-x64/bin/node;
--version reports v24.20.0. No global runtime changed. This HTTPS checksum check
is not release-signature verification and says nothing about installed Mac bytes.

## Next concrete checks

Local validation on exact Linux Node24.20.0 completed: fresh production build,
all59 measurement-preparation tests, both TypeScript configurations and all149
application tests passed. Tested application revision f0cebb5; this turn changed
documentation only. Browser tests were not rerun. No Swift build/native test or
Mac runtime test is claimed. git diff --check passed before commit.

- Read-only Mac inventory: exact dedicated Node archive/executable, release
  baseline/candidate binaries, source-input/lock manifests, architecture/signature,
  dynamic libraries and immutable/private paths. No imsg invocation yet.
- Finish source-to-artifact and native/helper/import closure review; independently
  review explicit worker startup/environment/IPC boundary before execution.
- Package fresh application from current source with pinned dependencies; old
  Linux stage b089af5 is not the final measurement bundle. Do not use the synthetic
  HTTP demo as a production server or weaken Secure-cookie/origin checks.
- Only then proceed to separately labeled raw cross-arm parity and C06 preparation.

Status: no Mac artifact admitted, no new live sample, C06 still incomplete and
production stopped. User UI feedback covers synthetic functional/display behavior
only, not design/normal-use requirements or actual Messages data correctness.
