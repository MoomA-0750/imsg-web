# P0a contract foundation

> **Scope note (2026-09-14).** This file describes the P0a milestone and is kept
> for its RPC client contract, which still holds. Since then the product gained
> a loopback HTTP listener, owner-key authentication and a LaunchAgent
> generator; database writes and Messages mutations are still absent. The imsg
> in use is a patched 0.15.4 (`imsg-patches/`), and the reader passes
> `--contacts-from-address-book`. For current state read `STATUS.md`.

Scope: Node24 TypeScript, persistent local read-only `imsg rpc`, typed adapter, capability diagnostics, non-content doctor output, synthetic tests. Build output is portable JavaScript; the Node executable is architecture-specific. No runtime npm dependencies. No HTTP listener, database writes, Messages mutations, authentication claim, or deployed LaunchAgent.

## Interfaces

- `ReadonlyRpcClient`: `request`, `onNotice`, `close`, `counts`. The method allowlist is enforced at runtime, not just in TypeScript. Executable and fixed argv are trusted local configuration, never browser input. `shell:false`.
- `ReadonlyAdapter`: status, chats, history, one watch subscription and unsubscribe. Positive safe-integer IDs, bounded limits, response validation, field whitelist. These are internal local IDs, not future Web API IDs.
- `capabilities`: normalized state/reason for chats/history/watch/contacts/read/typing/send. Read/typing are advertisements for diagnostics, never callable here. Send is always unknown/NOT_IMPLEMENTED.
- `doctor`: CLI entry via absolute `IMSG_PATH`. Structured summary only. RPC error text/data, stdout details, and stderr diagnostics are never printed.

## Bounds and failure semantics

4 active requests including control, 32 queued. Request37 fails immediately with QUEUE_OVERFLOW. 10-second deadline from admission. 64KiB request / 4MiB stdout-frame bounds; stderr drained without buffering. Unknown notifications do not become responses; IDs are exact strings; duplicate/unknown response IDs do not resolve other work.

Timeout or abort after dispatch closes the entire read-only child, fails all work, and prevents further dispatch. A queued abort only removes that queued request. Malformed frames and EOF fail pending work. No automatic reconnect or retry. Uncertain subscription creation closes the child before another instance may be created.

Close rejects new work synchronously, sends EOF, then SIGTERM after 2 seconds and SIGKILL after another 2 seconds. Failure to observe close within a final second reports SHUTDOWN_FAILED. Only the directly spawned child is signalled. There is no process-group kill or claim to clean up grandchildren. **This lifecycle must not be reused for a mutation-capable child.** A future shared read/mutation client needs a separately reviewed lifecycle.

## Capability truth table

| Input | Output |
|---|---|
| Malformed/missing RPC snapshot | unknown / RPC_STATUS_INVALID |
| Unverified version/protocol | unknown / VERSION_UNTESTED |
| Known version, DB unavailable | reads unavailable / DATABASE_UNAVAILABLE |
| DB ready + required method | reads available / SUPPORTED, regardless of bridge/contacts |
| Required method missing | unavailable / METHOD_UNAVAILABLE |
| Contacts denied | contacts unavailable / CONTACTS_UNAVAILABLE |
| CLI snapshot missing/mismatched | read/typing unknown / CLI_STATUS_INVALID; DB reads unchanged |
| SIP enabled | read/typing unavailable / SIP_ENABLED |
| SIP disabled + individual flag + method | diagnostic available / SUPPORTED |
| Individual flag false | unavailable / FEATURE_UNAVAILABLE |

Unknown CLI SIP/flag combinations remain unknown. A single bridge selector or a compiled method list is never sufficient. Initial checked versions: imsg0.14.2 and0.15.1. The M1 host's stock imsg is now 0.15.3; every audited call-path file is byte-identical to 0.15.1.

## Decisions and alternatives

The full application plan is a single Mac-local Node server serving a static React UI over Tailscale HTTPS, with an owner key/session boundary and SSE invalidations. The current milestone stops before that boundary. Python/FastAPI and Swift were alternatives; a Linux+SSH application would add a transport and file-transfer boundary. A local persistent subprocess keeps the P0a contract small.

No reconnect queue, message mirror, or mutation implementation is needed to validate read contracts. A shared mutation client and an isolated read client are future alternatives: the former needs non-killing recovery semantics; the latter adds a process. Do not silently extend this read-only client to send.

## Conversation list previews

`chats.list` carries no message text, so the newest message of each conversation is read
separately, as `messages.history` with `limit: 1`, and kept until that conversation's
last-message time changes. At most 50 are read per refresh: a long list fills in over a few
refreshes rather than making one of them slow, and a conversation not read yet leaves its line
blank rather than claiming it has no messages. This is the one place the read profile is N+1;
`docs/real-data-findings.md` records what it costs on real data.

## The face on a conversation

A conversation's row carries `faces`: one entry per person, holding the id of a picture the
address book has for them, or null where it has none, and empty where there is nothing to
show at all. One entry is a person; several are a group, which has no picture of its own and
so wears its members'. The place a face sits in is the UI's business; the server only says
who there is and whether there is a picture.

A person is matched on the name imsg resolved, a group's members on their handles, since imsg
resolves no names for those (`docs/real-data-findings.md` has the matching rule). Either way
an id is an HMAC over the key, bound to the current database generation, and only the bytes
are served, from `/api/avatars/:id`. No name, handle or contact identifier crosses.

## Styling

Tailwind v4, through `@tailwindcss/vite`; no CDN, no config file. `web/src/style.css`
holds the whole styling layer:

- The palette is blue, defined once as plain custom properties on `:root`, with a
  `prefers-color-scheme: dark` block redefining the same names. A sent message is
  the exception that carries meaning rather than decoration: `--sent-imessage`
  (blue) and `--sent-other` (green) follow Messages, blue only where the
  conversation is known to be iMessage. imsg reports the service per
  conversation, not per message, so that is the grain of the distinction. `@theme inline`
  hands those names to Tailwind, so `bg-surface` compiles to
  `background: var(--surface)` and the dark theme follows from the palette alone
  — no element carries a `dark:` twin. Change a colour in one place.
- `--breakpoint-pane: 600px` is where the two panes stop stacking. Below it they
  slide over one another; the `pane:` prefix carries the side-by-side layout.
- `.btn`, `.btn-secondary` and `.btn-compact` are the only component classes,
  because those shapes recur and would otherwise drift apart.
- Icons come from `@fluentui/react-icons`, imported one at a time so the bundle carries
  only what is used. It is a devDependency: the icons are compiled into `dist/web`, so
  nothing ships it. Unpacked it is large (~300 MB in `node_modules`), which is the price
  of not hand-copying SVG paths that would drift from the set.

Everything else is utilities in the markup, so a single element can be changed
where it is written. Elements also keep their semantic class (`bubble`,
`message-area`, `reply-quote`, …) as a hook with no styling attached: the browser
tests select on them, and they say what a thing is where a wall of utilities does
not.

## Primary sources

- [imsg v0.15.1 RPC](https://github.com/openclaw/imsg/blob/v0.15.1/docs/rpc.md)
- [imsg v0.15.1 JSON](https://github.com/openclaw/imsg/blob/v0.15.1/docs/json.md)
- [Node24.20.0 release checksums](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt)

Source contracts are not substitutes for actual app acceptance tests.
