# The API, for other programs

The web page and other programs use the same routes. A program, such as a home
dashboard that shows a chat panel, signs in with a **client token** instead of
the password. The page's cookie, CSRF token and Origin checks are not involved.

## Letting a program in

On the Mac, with the server running:

```sh
~/Library/Application\ Support/imsg-web/imsg-web client add dashboard          # may read
~/Library/Application\ Support/imsg-web/imsg-web client add dashboard --send   # may read and send
~/Library/Application\ Support/imsg-web/imsg-web client list
~/Library/Application\ Support/imsg-web/imsg-web client remove dashboard
```

`add` prints the token once, on stdout. Only its SHA-256 is kept, in
`state/clients.json`. To issue a new token, `remove` the client and `add` it
again. Removing a client takes effect at once, even for a request already in
progress. Clients are separate from the owner's password: changing the password
or running `auth revoke-all` does not affect them. A client name is lower-case
letters, digits and `-`, up to 32 characters. There can be up to 16 clients.

## Connecting

- **Address.** One the server already answers to: `https://<name>.local:8787`,
  the Mac's own IP address on that port, or the Tailscale Serve name if one was
  given at install. The `Host` header is checked exactly as it is for a browser.
- **Certificate.** On the LAN, the certificate is the self-signed one the
  installer made. It covers the `.local` name, `localhost` and the Mac's
  addresses at install time. Trust it explicitly: copy
  `state/tls/cert.pem` to the program and pass it as the CA. Do not turn off
  verification. In Node, that means `https.request({ ca })`, or an undici `Agent`
  with `connect: { ca }`. Through Tailscale Serve the certificate is a real one,
  and nothing extra is needed.
- **Headers.** Send `Authorization: Bearer <token>`. Do not send `Origin`,
  `Cookie` or `Sec-Fetch-Site`, because the server refuses a token request that
  carries any of them (`403 CLIENT_FROM_BROWSER`). This keeps a token from ever
  being usable from a web page. So call the API from the program's server, not
  from a page in a browser.

```js
import https from 'node:https';
const ca = readFileSync('imsg-web-cert.pem');
https.get({ host: 'my-mac.local', port: 8787, path: '/api/chats', ca,
  headers: { authorization: `Bearer ${process.env.IMSG_WEB_TOKEN}` } }, response => { /* JSON */ });
```

## Routes

Responses are JSON, apart from attachments and pictures. An error is
`{ "code": "..." }` with a 4xx or 5xx status.

| Route | Scope | What it returns |
|---|---|---|
| `GET /api/capabilities` | read | What works right now. `features.send` is `off` for a read client |
| `GET /api/chats?limit=50` | read | Conversations, newest first. `limit` is 50–1000 in steps of 50 |
| `GET /api/chats/:id/messages?limit=50` | read | A conversation's latest messages, oldest first |
| `GET /api/attachments/:id` | read | An image or recording, by its own type. Supports `Range` |
| `GET /api/avatars/:id` | read | A contact picture (JPEG or PNG) |
| `POST /api/uploads?name=<file>` | send | Body is the file as `application/octet-stream`. Returns `{ uploadId, bytes, name }` |
| `POST /api/send` | send | JSON `{ chatId \| to, text?, uploadIds? }`. Returns `{ state, sent?, total? }` |

The shapes are in `src/shared/web-types.ts`: `ChatSnapshot`, `HistorySnapshot`
and `CapabilitySnapshot`. Notes on using them:

- **Ids are opaque and temporary.** Chat, message, attachment and picture ids
  belong to the server's current *epoch*. The epoch changes when the server
  restarts or Messages' database is replaced. Do not store an id. Fetch
  `/api/chats` again to get current ones. A stale chat id gives
  `409 STALE_CHAT`, and a read that crosses an epoch change gives
  `409 DB_CHANGED`.
- **New messages.** There is no push. Poll `/api/chats` and compare
  `lastMessageAt`, then fetch the history of the conversations that changed.
  The page polls every 15 seconds.
- **Sending.** Give `chatId` (from `/api/chats`) for an existing conversation,
  or `to` (a phone number or email address) to start one. Send text, attachments
  or both. Upload each attachment first. Each file is sent as its own message,
  up to 10, each at most 100 MiB. An upload not used in a send is discarded
  after 10 minutes.
- **What `state` means.** `sent`: imsg acknowledged it. `failed`: it did not
  start, so it is safe to retry. `unknown`: it may or may not have gone, so do
  not retry blindly. `dry_run`: the server is in dry-run mode and nothing was
  sent. The server does not report read receipts or delivery.
- **Not available:** replying to a specific message, tapbacks, marking as read,
  typing, and search. These are the same limits as the page has; see the
  README.

## Limits

- 120 requests a minute per client.
- 10 sends a minute per client (uploads count). This allowance is separate from
  the owner's and from other clients'.
- JSON responses are capped at 4 MiB. 32 requests are handled at once across
  everything, and the server answers `429 BUSY` past that.
- A request body is at most 2 KiB, apart from uploads.

## What a client token does not change

The browser's path is untouched. The page still needs the password, the
`Secure` `SameSite=Strict` cookie, the exact Origin and the CSRF token. A
client token gives access only to the routes above. It never reaches the
session or password routes: it cannot sign in as the owner, change the password
or end the owner's sessions. Anyone holding a `--send` token can send as you,
so keep it where the program's other secrets are, and `remove` the client if it
leaks.
