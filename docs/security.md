# How it is kept safe

The threat this takes seriously is the obvious one: it reads every message you
have, so it should be hard to reach and impossible to reach by accident.

- **https only, on one port.** The server carries its own TLS, with a
  certificate the installer made on the Mac (RSA 2048, key 0600 in the state
  directory); there is no plain http listener at all. It listens on every
  interface, or on `127.0.0.1` alone when installed with `--no-lan`, and answers
  to `localhost`, the Mac's `.local` name, the Mac's own current addresses and
  whatever address was given for something in front — nothing else, each Host
  held to its own Origin. The certificate is self-signed: a device warns once, and the
  installer prints its fingerprint so the owner can check it is this one rather
  than someone else's on the same network. Anyone on that network can reach the
  sign-in page; the password is what keeps them out. Beyond the LAN, something in
  front has to carry its own TLS — Tailscale Serve, a reverse proxy. It is not
  built to be exposed publicly.
- **One password**, hashed with scrypt (N=2¹⁶, about 150 ms per attempt), stored
  in a 0700 directory. Sessions are `__Host-` cookies, `Secure`, `HttpOnly`,
  `SameSite=Strict`, and lapse after a day idle or a week outright. There is no
  sign-out button because there is one account; `auth revoke-all` ends every
  session from the Mac. The installer starts with a random temporary password;
  the first sign-in with it asks for the owner's own, and that request (session
  plus CSRF, like every mutation) is the only way the browser can change the
  password — once one is chosen, changing it again is done on the Mac.
- **Other programs use a client token**, never the password (`docs/api.md`).
  The owner issues a token on the Mac, scoped to reading or to reading and
  sending. Only its SHA-256 is stored, and removing the client cuts it off
  at once. A token request must carry no `Origin`, `Cookie` or `Sec-Fetch-Site`,
  so no web page can use one: the browser's path keeps all of the checks
  below. A token reaches only the read and send routes, never the session or
  password routes. Each token has the same 120 requests and 10 sends a minute
  as a session, counted separately.
- **Exact `Origin` and `Host` checks** on every request, a CSRF token on every
  mutation, at most 20 logins a minute, 16 sessions at once, 120 requests a
  minute per session, and 10 sends a minute.
- **The read path can only read.** The RPC client enforces a method allowlist —
  `status`, `chats.list`, `messages.history`, `watch.subscribe`,
  `watch.unsubscribe` — at run time, not merely in types. Sending is a separate
  client and a separate short-lived process, and the two never share a path.
- **Nothing leaves the Mac.** No push service, no analytics, no fetching of link
  previews (Messages already stored them, and fetching would tell the site when
  you read a link), no outbound request of any kind. The page's
  Content-Security-Policy allows `'self'` and, for playing back something you
  just chose or recorded, `blob:`. `Permissions-Policy` closes every device to
  the page except the microphone.
- **Identifiers do not cross.** Chat and message ids in the browser are HMACs
  over a per-process key, bound to the database generation. Paths, handles and
  filenames never reach it. Replace `chat.db` and every id the browser holds
  stops meaning anything, which is also how a restored backup is noticed.
- **Attachments are checked, not trusted.** A file is served only if it really
  lies inside Messages' own directories after symlinks are resolved, is a
  regular file within a size bound, and begins with the bytes of a type on a
  fixed allowlist — served with that detected type, `nosniff`, and a `sandbox`
  Content-Security-Policy of its own. SVG is not on the list, because it can
  carry script.
- **Sending is its own path.** It is on by default, because an app that can only
  read is a strange thing to install, but it never reuses the read client, it
  can call one method (`send`) over AppleScript, and it dispatches one message
  at a time. `IMSG_WEB_SEND=off` closes it; `dry-run` validates and dispatches
  nothing.
- **Nothing is written to Messages' own files.** The database is opened
  read-only, and no read state, no typing indicator and no marker of any kind is
  ever set. SIP and TCC are never touched.

## What is not defended against

- **Someone who already has your Mac's user session.** The password protects the
  network side; a person at the keyboard has Messages itself.
- **A browser you signed into and left.** A session lasts a day of inactivity.
  On a device you do not control, sign in and then use `auth revoke-all`.
- **Exposure to the public Internet.** Put it behind your own network. Tailscale
  Serve is what this was built and tested against.
- **A network you do not trust.** On café or shared Wi-Fi, everyone there can
  reach the sign-in page, and someone who can intercept traffic can present a
  certificate of their own — which is what the fingerprint check is for. A Mac
  that travels is better installed with `--no-lan` and reached over Tailscale.

## What it will not do to your Mac

It does not change SIP or TCC, does not ask for permissions, does not launch or
repair Messages.app, and does not install anything outside its own directory and
one LaunchAgent. `npm run doctor` is the one exception worth knowing about: it
calls upstream `imsg status`, which may launch or repair Messages.app, so it is
not the harmless check it looks like.
