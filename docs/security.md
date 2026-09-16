# How it is kept safe

The threat this takes seriously is the obvious one: it reads every message you
have, so it should be hard to reach and impossible to reach by accident.

- **Loopback only.** The server binds `127.0.0.1`. Whatever fronts it — Tailscale
  Serve, an SSH tunnel — is what decides who can connect at all. It is not
  reachable from the network without something in front of it, and it is not
  built to be exposed publicly.
- **One password**, hashed with scrypt (N=2¹⁶, about 150 ms per attempt), stored
  in a 0700 directory. Sessions are `__Host-` cookies, `Secure`, `HttpOnly`,
  `SameSite=Lax`, and lapse after a day idle or a week outright. There is no
  sign-out button because there is one account; `auth revoke-all` ends every
  session from the Mac.
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

## What it will not do to your Mac

It does not change SIP or TCC, does not ask for permissions, does not launch or
repair Messages.app, and does not install anything outside its own directory and
one LaunchAgent. `npm run doctor` is the one exception worth knowing about: it
calls upstream `imsg status`, which may launch or repair Messages.app, so it is
not the harmless check it looks like.
