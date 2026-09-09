# Experimental upstream patches

These patches preserve the isolated contact-batching experiment; they are not installed, vendored application dependencies, or an upstream release.

- `imsg-0.14.2.patch`: apply to upstream commit `c99e6d0` (v0.14.2); candidate commits `08b50a7` then `6ded519`.
- `imsg-0.15.1.patch`: apply to upstream commit `646ea7a` (v0.15.1); candidate commits `f9ff018` then `6d7d0d1`.

Use an isolated upstream checkout and `git apply --check` before applying. Review upstream AGENTS.md and the application's `docs/custom-read-preflight-record.md` and `docs/release-comparison-record.md`. No automatic build/install script is provided. The 0.14.2 pinned lock lacked transitive entries and required isolated resolution preserving direct pins; the exact resulting lock digest is recorded in the preflight evidence. These patches intentionally do not alter dependency pins or signature/permission setup.

Changes cover request-local Contacts lookup for chats.list and messages.history, final observed-revocation filtering, stale in-flight load invalidation and deterministic tests. They retain scalar Linux behavior. Known baseline send/bridge test failures, remaining mixed-payload test coverage, access-context differences and unaccepted C06 performance are documented; do not treat the patches as production-approved.
