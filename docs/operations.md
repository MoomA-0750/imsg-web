# Operations

How the read-only web UI runs on a Mac. One instance per Mac, operated in the
Messages owner's GUI session.

## Path and boundary

```
Browser -> Tailscale Serve HTTPS :443 -> http://127.0.0.1:8787 -> imsg rpc (read-only)
```

- The app binds loopback only. Never bind it to LAN or all interfaces, and never
  enable Funnel.
- Tailscale gets you to the login page; the owner key is what gets you in. Do
  not use Tailscale identity headers as authentication.
- Host/Origin must be exactly `https://<host-fqdn>`.
- HTTPS certificate issuance publishes the FQDN in Certificate Transparency
  logs.
- Only `status`, `chats.list`, `messages.history`, `watch.subscribe` and
  `watch.unsubscribe` can reach imsg. No web route changes anything.

## Files

```
~/Library/Application Support/imsg-web/   (0700)
  runtime/node-v24.20.0-<arch>/           official Node, checksum verified
  runtime/libwebp-1.6.0-mac-<arch>/       official libwebp, signature verified
                                          (optional: WebP for converted HEIC)
  releases/<commit>/                      dist, package files, node_modules,
                                          imsg + its two .bundle directories
  state/                                  owner hash (0600), lock
  logs/                                   stdout / stderr (0600)
```

Do not run production from the repository or a temp directory, and do not use a
`current` symlink. `imsg` is the patched build from `imsg-patches/`.

## Permissions

Full Disk Access for the dedicated Node binary only, granted by the owner in
System Settings. That covers both `chat.db` and the AddressBook store. No
Contacts grant is needed. Never edit TCC databases or change SIP. SSH working
does not prove the LaunchAgent works: under launchd the responsible process is
the Node.

## LaunchAgent

Generate the plist; it never installs or starts anything:

```sh
<node> scripts/generate-launch-agent.mjs --base <base> --release <release> \
  --imsg <release>/imsg --origin https://<host-fqdn> --port 8787 \
  --label local.imsg-web.readonly --stateName state --output <new-plist> \
  --cwebp <base>/runtime/libwebp-1.6.0-mac-<arch>/bin/cwebp   # optional
```

Without `--cwebp`, HEIC is converted to JPEG with the system `sips` only.

The owner places it at `~/Library/LaunchAgents/local.imsg-web.readonly.plist`
and loads it with `launchctl bootstrap gui/$(id -u) <plist>`. It starts at login
and is not restarted automatically after a crash.

## Owner key

The owner runs `setup` / `auth rotate` in their own terminal and keeps the key
in a password manager. The key never goes into chat, logs, argv, environment or
this repository.

## Serve

With the owner's approval at the time, and after checking `tailscale serve
status` shows nothing unexpected:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8787
```

## Stop

1. Turn off only this Serve route.
2. `launchctl bootout gui/$(id -u)/local.imsg-web.readonly`
3. Check the app and its imsg child are gone and port 8787 is closed.

If it does not stop cleanly or a lock remains, leave the lock where it is and
ask the owner. Never delete lock or socket files automatically, and never
`killall imsg`: the iMac runs another system's imsg.

## Update

Put the new build in a new `releases/<commit>/`, stop, point the plist at it,
start, log in and check. To roll back, point the plist at the previous release.
The owner hash in `state/` is never rolled back.

## During the trial

The owner uses it normally. Occasionally check memory for the app and its child
(`ps -o rss= -p <pid>`) and that the logs stay small and free of message
content.
