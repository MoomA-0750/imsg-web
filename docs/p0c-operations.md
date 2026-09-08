# P0c Operations Runbook

> Status: limited deployment preparation. See p0c-acceptance.md for executed checks and blockers. Tailscale Serve/HTTPS, performance, rollback and OS-reboot recovery are not yet certified.

## Scope and boundary

P0c is an authenticated, read-only iMessage web UI operated by the Messages owner's GUI session. It is not a sending/receipt-changing product, a data mirror, or a multi-host data-integration service. Each Mac has an independent instance and state.

Browser traffic is constrained to:

```
Browser -> Tailscale Serve HTTPS :443 / -> http://127.0.0.1:8787 -> read-only imsg child
```

Do not enable Funnel, bind the app to LAN/all interfaces, or use Tailscale identity/forwarded headers as application authentication. Require the exact `https://<host-fqdn>` Host/Origin, and use the application owner key/session/CSRF boundary. The tailnet ACL may be unknown: authorized tailnet clients can reach the login page, but must not be described as owner-only network access. HTTPS certificate issuance records the FQDN in public Certificate Transparency logs; this is an approval prerequisite.

The localhost TCP design trusts the Mac as its local security boundary. It does not protect against untrusted local code that can take port 8787 while the app is stopped. A planned stop must turn off Serve first. If that boundary is unacceptable, do not deploy this design; use a separately designed authenticated backend TLS/private-socket arrangement.

## Files, immutable releases, and LaunchAgent

Use only the owner-private base directory:

```
/Users/<owner>/Library/Application Support/imsg-web/  (0700)
  runtime/node-v24.20.0-<arch>/
  releases/<commit>/
  state/
  logs/
```

Create `state/` at setup with mode 0700 and its owner hash with mode 0600. Validate generated Unix-socket paths are at most 100 bytes. Do not run production from a repository or temporary directory.

Each immutable release contains its `dist`, package/lock data, and fixed runtime dependencies. Verify the official Node SHA-256 and release artifact SHA-256; verify that installation parents are owner-controlled and not symlinks, and reject existing collisions. The plist contains absolute paths to that release's Node and `main.js`: do not use a `current` symlink or replace global Node.

Use the Messages owner's GUI LaunchAgent only:

- label/path: `local.imsg-web.readonly`, `~/Library/LaunchAgents/local.imsg-web.readonly.plist`
- domain/session: `gui/<uid>`, Aqua
- `RunAtLoad=true`, `KeepAlive=false`, `ExitTimeOut=45`, `Umask=63` (077), and default `AbandonProcessGroup=false`
- explicit working directory and four approved environment entries; no shell and no secret in argv or environment
- dedicated stdout/stderr files mode 0600; normal output is fixed start/stop text only

Run the fixed Node with `scripts/generate-launch-agent.mjs --base <base> --release <release> --imsg <absolute-imsg> --origin https://<host-fqdn> --port 8787 --label local.imsg-web.readonly --stateName state --output <absolute-new-plist>`. Quote paths containing spaces. The generator refuses root/non-macOS/wrong-Node execution, invalid paths and unsafe ownership. It creates only a new plist and absent 0600 log placeholders, never starts or installs the Agent. Existing log files must already be private; they are never truncated. Partial failed output remains for inspection and must not be loaded. Do not rely on launchd Umask alone to create logs privately: different macOS versions have produced different modes.

Messages DB access must work in the actual launch context. SSH success does not establish LaunchAgent permission. If an Agent returns DATABASE_UNAVAILABLE but the same runtime works over SSH, stop and ask the owner to inspect Full Disk Access for the actual dedicated Node binary. Never modify TCC databases or disable SIP. Full Disk Access is broad; approve only the dedicated trusted runtime, then restart the Agent and re-test. See [imsg permissions](https://github.com/openclaw/imsg/blob/main/README.md) and [Apple privacy controls](https://support.apple.com/en-au/guide/mac-help/mchl211c911f/mac).

The service begins once at GUI login. It may remain resident, but a crash must not unconditionally restart it. Login-before-GUI, power-loss, and unattended recovery are not guaranteed.

Keys are generated or rotated by the owner in an interactive terminal and stored in a password manager. Never put them in agent chat, tool output, argv, environment, logs, captures, or repository files. Test keys exist only in pipe/memory, are revoked after testing, and the owner rotates to the final key.

## Ordered deployment and acceptance work

Proceed only in this order: generator validation -> isolated-state Agent validation -> production state plus loopback validation -> Serve/HTTPS validation -> owner key handoff. A failed safety test blocks every later stage.

Before adding Serve, re-read and compare its displayed configuration. If it differs from the approved empty configuration, stop. Add only the approved root route to `127.0.0.1:8787` with HTTPS 443. If permissions or an HTTPS prompt appears, stop; do not change Tailscale-wide settings or ACLs.

Verify a real tailnet browser connection with normal certificate validation, login/read-only access, 401 before authentication, strict Host/Origin behavior, absence of Funnel, and external non-reachability of 8787. Configuration output is not proof of reachability. Never save message bodies, IDs, addresses, keys, network dumps, or real-screen captures; retain only permitted synthetic screenshots and sanitized results.

Read-only enforcement permits only `status`, `chats.list`, `messages.history`, `watch.subscribe`, and `watch.unsubscribe`; P0c UI uses the first three. CLI children are fixed `status --json`; RPC children are fixed `rpc`; no shell is used, history disables attachments, and no changing Web route exists. Test that send/read/typing/edit requests are rejected and prohibited methods reach no child process.

## Stop, update, and recovery

### Planned stop

1. Compare the currently owned Serve route with the expected route, then turn off only that 443 root route.
2. Boot out only `local.imsg-web.readonly` from its GUI domain.
3. Confirm app/admin/RPC termination, loopback port closure, and normal lock release.

The planned-stop acceptance target is **30 seconds or less** from request, including HTTP maximum 10 seconds, reader 5 seconds, and admin maximum 5.5 seconds. More than 30 seconds, a forced kill, or retained lock fails normal stop. `ExitTimeOut=45` is launchd's kill allowance, not a successful-stop criterion; reaching 45 seconds does not establish that the service exited. Do not use `killall imsg`, stop an existing watcher, reset Tailscale, or restore settings in bulk.

### Update and rollback

Prepare a candidate in a separate release directory, preserve the old release, perform a planned stop, privately back up the plist, update its absolute paths, then start and validate authentication plus real read-only access. Rollback is allowed only between schema-1-compatible read-only releases: stop the new process conclusively, restore the old plist, and validate again.

Never roll back the owner hash or state; all sessions must reauthenticate. A schema change requires a separate plan.

The initial exercise uses the **same verified artifact in two different release paths** and switches old -> new -> old. It demonstrates plist/path switching, hash consistency, authenticated reads, and old-session invalidation. It does **not** demonstrate rollback to a different older version. Do not claim such rollback as proven until an approved compatible-version exercise has occurred. A release with a known critical vulnerability, schema incompatibility, or unverified runtime is not a rollback candidate; if no safe candidate exists, remain stopped.

### Abnormal exit and retained lock

First stop the entry route, then the target label. Investigate the owned process tree, process group, and execution paths; lack of a PID alone is not proof of stop. Preserve the lock and keep service stopped unless termination acknowledgements, all owned child exits, and cessation of writes are proven. Never automatically delete a stale lock.

The standard manual path for an unproven crash is: boot out the target Agent; privately retain the plist at its original permissions; obtain owner approval and prepare local recovery; reboot the OS; confirm a changed `kern.bootsessionuuid`, no automatic load, and no old-release process; copy the full state tree to owner-0700 preservation storage; move (do not delete) only lock/socket to the same private preservation location; do not move or roll back `owner.json`; recheck owner hash and permissions; start the Agent, authenticate, and rotate the key; restore Serve only last.

OS-reboot lock recovery is **unverified**. Until an approved isolated-state rehearsal finishes, it is not accepted normal-operation recovery. Without reboot approval or sufficient stop evidence, remain stopped and report the condition. Never restore the Messages database.

## Performance measurement definition

All performance work is P0c-unexecuted. Compare foreground control and Agent under the same Mac, imsg version, release, and local selected conversation. Test up to 50 chats and 50 messages; when fewer exist, record the actual count and do not claim 50-item coverage.

- **Cold:** after app start, from `capabilities -> chats -> selected history` HTTP start until final body parse completes; do not purge OS DB cache.
- **Warm:** the same cycle 20 times, 15 seconds apart; record all 20 successes. p95 is the 19th value after ascending sort.
- **RSS:** sample every 5 seconds for 30 minutes across app plus traced RPC/CLI children; use the first 5 minutes as warm-up and compare medians for minutes 5--15 and 20--30. Investigate a later increase exceeding both 20% and 32 MiB; record peak and child restart count without treating PID changes as zero use.
- **Concurrency:** separately test two polling clients with synthetic imsg delay/timeout, asserting one active plus 32 distinct waiters, duplicate coalescing, HTTP 32 active/TCP 64, per-session 120/minute, and no revival of expired responses.

`p95 <= 3s`, `cold <= 10s`, and owned RSS `<= 512 MiB` are preliminary trial-readiness discussion thresholds, not user-approved SLOs. A 30-minute poll is a continuity test. If a threshold is exceeded, stop deployment and present evidence plus remediation or a request for explicitly limited testing; do not reinterpret results as passing.

## Manual maintenance

Weekly, the owner checks launch state and log size, immediately after abnormal exit as well. **1 MiB is a maintenance trigger, not a hard log limit.** On reaching it or seeing unexpected output, stop the entry and Agent, preserve the logs privately, create new logs, and scan the combined stdout/stderr including exception and library output for secret exposure. Do not record keys or message content.

Monthly, the owner reviews security information for Node 24, runtime dependencies, imsg, and Tailscale. A newly disclosed remotely reachable critical issue requires entry shutdown, validation of a fixed separate release, then explicit restart; do not automatically upgrade.

No automatic stale-lock recovery, root daemon, Tailscale replacement, auto-login/power configuration, Messages or watcher changes, or public repository publication is part of P0c.
