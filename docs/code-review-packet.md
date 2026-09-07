# Independent P0a code review

Read only this workspace's `src/`, `tests/`, `package.json`, TypeScript config, `README.md`, `docs/architecture.md`, and `docs/acceptance.md`. Do not read `docs/reviews.md` or other reviewers' conclusions. No file writes, shell execution, external requests, or modifications to any service.

Product requirements: single-owner self-hosted Mac web wrapper for imsg; public-safe source; SIP-enabled basic functionality and capability-gated advanced functionality; eventual Tailscale-only access with app authentication; no unintended resend, SMS downgrade, private data logs, or Messages DB modification. Full Web UI is not the current implementation unit.

Current P0a scope: a local read-only RPC client, adapter, capability diagnostics and doctor; bounded framing/concurrency/queue/deadline/shutdown; no sending, read-state mutations, HTTP server, auth implementation, or service deployment. Assertions and exact current limits are in architecture.md and acceptance.md.

Find counterexamples, security/privacy defects, lifecycle/resource leaks, false-positive acceptance tests, and reasons to reject the current code. Give severity, file/line, reproducible scenario, minimal fix, and whether it blocks P0a. Distinguish current defects from future implementation gates. A lack of findings should be explicit. Do not seek agreement with the author.
