# P0b internal read-only operation contract

2026-09-08. This is not a production installation guide or approval to modify Tailscale/LaunchAgent settings. The real-device test uses temporary foreground processes only. Historical P0a docs describe that earlier slice; this file describes the added web boundary.

## Prerequisites and configuration

macOS owner already has Messages configured and imsg DB access. Use a dedicated Node24.20.0 runtime; do not replace a global runtime. Build with the exact lock (`npm ci --ignore-scripts`, `npm run build`). Runtime packages are Fastify/cookie/React; no runtime external service or CDN. Runtime deployment needs built `dist`, package/lock, and `npm ci --omit=dev --ignore-scripts`.

| Variable | Contract |
|---|---|
| IMSG_WEB_STATE_DIR | Absolute path to an initially absent leaf under a trusted owner-controlled parent; short enough that `<leaf>/admin.sock`≤100 bytes |
| IMSG_WEB_IMSG_PATH | Absolute executable path, no command string or shell expansion |
| IMSG_WEB_ORIGIN | Canonical `https://host` or `https://host:port`, no trailing slash/path/query/fragment/userinfo |
| IMSG_WEB_PORT | Loopback port1024–65535, default8787; never external bind |

No key in argv or environment. `node dist/main.js setup` creates the private leaf and hash, printing the new owner key once to stdout. Save that output in an appropriate password manager, not logs, shell arguments, tickets or repo files. Existing directories are refused; no automatic adoption/chmod. Server: `node dist/main.js serve`. It logs only a generic startup/shutdown result, not request/body/account data.

The eventual Tailscale HTTPS proxy must preserve the configured Host and Origin and forward only to127.0.0.1. Tailscale identity headers do not authenticate the app. Browser HTTP is unsupported: Secure __Host cookie and HTTPS origin checks intentionally remain enabled. Do not relax them to make a local HTTP preview work. The browser test fixture supplies synthetic HTTPS separately.

## Local administration

Use the same state directory and `node dist/main.js auth status`, `auth revoke-all`, or `auth rotate`. Short aliases `status`, `revoke`, `rotate` also work. Unix socket access is limited by0700 directory/0600 socket, current uid and local filesystem trust. Status contains only blocked/sessions/rotating. No HTTP administration endpoint exists.

`revoke-all` immediately invalidates all current sessions but leaves the owner key valid for new logins. `rotate` first disables auth and clears sessions, writes/fsyncs/renames/fsyncs the replacement hash, activates it, then prints the new key. Old sessions do not revive if any stage fails. If persistence or the ACK fails, use local status and rotate again; an ACK failure can mean the key changed even though the caller did not receive it. Never infer that the old key still works. Management remains available while auth is blocked.

Sessions are memory-only: max16, seven-day maximum,24-hour idle counted from authenticated API access (including polling). Restart invalidates all. Session cookie HttpOnly/Secure/Strict, logout requires same-origin JSON+CSRF. Logout clears UI immediately; if revocation request fails, the UI explicitly says the server session may remain valid. Previously delivered data cannot be remotely erased. The app does not persist the key or message bodies in browser storage; browser password saving is the user's choice.

## Stop and recovery boundaries

SIGINT/SIGTERM stops authentication before draining HTTP and closing the owned read-only child. HTTP grace5s then force-close and bounded final check; reader grace5s; admin grace5s including outstanding key rotation. Failure is nonzero and retains the instance marker. No repeated kill/automatic reconnect after an unconfirmed child stop. This lifecycle is for reads only, never copy it to sending.

Normal confirmed stop releases only its marker; Node removes its own listening socket. Duplicate startup must not remove the previous marker/socket. Stale artifacts after crash are deliberately not auto-removed. Do not simply delete the marker and retry: first establish that the old app, its RPC/CLI children and any in-flight owner write have stopped. PID existence alone or a missing socket is insufficient proof. Production recovery tooling/rehearsal is a remaining gate; this internal slice does not automate risky stale-lock cleanup.

Incomplete setup leaves the private leaf for inspection. Do not overwrite it blindly. If its hash is intact, start the foreground app and rotate through its private socket to obtain a known key. If setup never produced a valid owner file, use a new private leaf only after confirming the failed setup/server has stopped; retain the failed directory until inspected. No Messages data is stored in that leaf.

DB path identity is sampled before/after reading and at fresh connection bootstrap; changed/missing DB retires reader/epoch/opaque IDs and requires a fresh selection. Same-inode in-place restore cannot be detected reliably; stop the application and restart after such a restore. Raw rowids are never accepted from the browser. At map2001 entries the app rotates epoch and refreshes the list rather than redirecting old IDs.

Bounds: global20 logins/minute,120 API requests/session/minute,16 sessions,32 active HTTP,64 TCP, admin4 connections/2KiB/5s. Read source one active+32 distinct waiting operations with exact-key coalescing. UI limit50–1000 in50 increments, name512/text16384 UTF16 units, visible trimmed indicator, response4MiB; oversized snapshots fail413 rather than silently returning partial success. Text is rendered literally, no automatic links, remote images or attachment paths.

## Not yet certified

Production Tailscale Host handling/ACLs, exact LaunchAgent program paths/environment/TCC, sleep/reboot behavior, crash/restore runbook, practical performance/p95/large real datasets, concurrent mutation by existing tools, third-party message delivery, and clean installation are not proved by the temporary HTTP probe. Sending, attachments/search/SSE and all capability-gated mutations remain future work. No license grant, GitHub publication or push is included.
