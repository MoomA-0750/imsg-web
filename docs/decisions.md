# Decisions

Decisions and findings worth keeping, newest first. Current state is in
`docs/HANDOFF.md` and `STATUS.md`.

## 2026-11-16 — rpc subprocess tests: timeouts must outlast child startup

- **What happened.** Three cases in `tests/rpc.test.ts` ("an active timeout
  closes the child…", "detaches inherited pipes on failed shutdown…", "does not
  redispatch after a late subscribe response") failed on the Linux PC.
- **Cause: the tests, not the product.** They used 50–100 ms timeouts, but Node
  takes about 110 ms to start the fake imsg there (about 36 ms on the Mac with
  Node 24.20.0). The timeout fired before the child had read the request. The
  rpc client, the fixture and the tests had not changed since 2026-09-12, so no
  commit introduced it; on the Mac the 50 ms case had little margin too.
  Production uses 10 s per request and 2 s shutdown grace and is not affected.
- **Decision (owner chose "lengthen the waits" over "Mac-only" or "leave
  it").** Timeouts raised to 400–800 ms, the late-subscribe fixture delay to
  800 ms (`5c9a215`). The inherited-pipe case cannot go much above 400 ms: the
  fixture's helper lives 1.8 s, and close() needs about 1.1 s after the timeout
  to report `SHUTDOWN_FAILED` while the helper still holds the pipes. At 1000 ms
  it failed again: the helper had exited first, so close() resolved.
- A `tests/p0c-boundary.test.ts` case failed once while other builds ran in
  parallel; it also uses a fixture child with short timing and is likely the
  same kind of problem. Not reproduced.

## 2026-11-19 — Favicon and apple-touch-icon

- Asked for by the owner: the sign-in page had no icon and the browser logged a
  404. The icon is kasane personal's seed colour (`--seed: #1f5fa8`, which
  kasane says should match the app icon) with a white speech bubble.
- `web/public/` holds `favicon.svg` and `apple-touch-icon.png` (180×180, square:
  iOS rounds the corners itself). The server serves those two names from the
  build, as a fixed list, the same way it lists `assets/` rather than mapping
  URL paths to files. No `favicon.ico`: every browser the owner uses takes the
  SVG once the page links it, and so does not probe for `.ico`.
- The PNG is drawn from `scripts/icons/apple-touch-icon.svg` with Playwright's
  Chromium (`scripts/icons/render.mjs`), which the tests already need.

## 2026-11-20 — Caching and compression of the built page

- Asked for by the owner: a reload was slow for what it loads. Every static
  file went out `no-store` and uncompressed, so each reload fetched about
  307 KB again (JS 252 KB, CSS 53 KB). Tailscale Serve does not compress.
- `src/server/static-files.ts`: each built file is read once at start, given a
  weak ETag (sha256 of the bytes; weak because it goes out in up to three
  encodings) and, if it is text of 1 KB or more, compressed with brotli (q11)
  and gzip (9). A request picks br, then gzip, else the bytes as they are, by
  `Accept-Encoding`, and gets 304 when `If-None-Match` matches.
- `/assets/*` with Vite's 8-character hash in the name: `public,
  max-age=31536000, immutable`. The page, the icons and any asset without a
  hash: `no-cache` + ETag. The API and everything else keep `no-store`; the
  security headers are set before any of this and are unchanged, 304 included.
- Measured with the browser-test fixture in Chromium, with its certificate
  trusted (a certificate error stops Chromium caching at all): first load
  307 KB → 82 KB (JS 70 KB, CSS 9 KB as br); a later reload 307 KB → 1.2 KB
  (two 304s; JS and CSS not requested).
- Cost: about 1 s more at start on the Linux PC for brotli q11. Not moved to
  build time, since start is once and the files are few.
- `assets/` now also lists `.svg` and `.woff2`, which Vite emits when CSS
  refers to them; none are built today.
