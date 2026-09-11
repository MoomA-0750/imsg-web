# Synthetic interactive preview

This separate HTTP server serves the existing built React UI with invented data.
It does not import production authentication/server/RPC modules, start imsg,
access Messages or change the production HTTPS/Secure-cookie requirements.
The persistent banner identifies the demo and shows the public fake key `demo`.
Never enter a real owner key. The fake cookie is only a UI exercise, not access
control; any peer allowed to this IP/port by existing tailnet policy can view it.

After building the app:

```sh
node scripts/demo-preview.mjs <this-machine-tailscale-ipv4> 18787
```

It binds only that exact100.64.0.0/10 address, never0.0.0.0. No Serve, Funnel,
firewall or startup-service changes. This is a temporary foreground process;
Ctrl-C/SIGTERM stops it. Closing the host/session may stop availability. No
real data or credentials should ever be added to this fixture.

Open `http://<this-machine-tailscale-ipv4>:18787` from an allowed tailnet device.
Login with `demo`, select conversations, try the empty conversation, load more,
resize or use a phone, and log out. The60 synthetic conversations/history entries
allow paging checks. No sending, search or attachment support is implied.
Browser HTTP warnings are expected for this synthetic-only preview; don't enable
HTTPS-only fallback to this port. Tailscale protects transport between peers,
but browser HTTP is not a secure context and does not certify production auth.

Validation (2026-09-12): API test passed; Chromium1280x800 and390x844 login,
history, logout, mobile back/empty state and horizontal overflow checks passed.
Actual remote PC/phone reachability remains for the user to confirm. No production
code was modified. Existing dist was reused; this is not a new release build.

```sh
node --test scripts/demo-preview.test.mjs
node scripts/demo-preview-browser.mjs http://<this-machine-tailscale-ipv4>:18787
```
