import { createApiTransport } from './nonlaunch-api-transport.mjs';
import { createApiWorkload } from './nonlaunch-api-workload.mjs';

// One synthetic/isolated session, not a live launcher. Caller transfers ownership
// of an already-listening app and its matching auth/source/reader gate. Never
// supply a production/shared app: all sessions are revoked and the app is closed.
export async function runApiSession({ app, auth, source, readers, key, origin, signal, timeoutMs = 15_000,
  overallMs = 45_000, cleanupMs = 10_000 }) {
  let transport, sample = null;
  const validDuration = n => Number.isInteger(n) && n >= 1 && n <= 60_000;
  const valid = validDuration(overallMs) && validDuration(cleanupMs);
  const controller = new AbortController();
  let interrupted = false, deadlineExceeded = false, cleanupExpired = false, workTimer, workDeadline;
  const abort = () => { interrupted = true; controller.abort(); };
  const cleanup = { revoked: false, transportClosed: false, sourceClosed: false, readersClosed: false, readersNormal: false, appClosed: false };
  try {
    if (!valid || (signal !== undefined && !(signal instanceof AbortSignal))) throw new Error();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    workDeadline = performance.now() + overallMs;
    workTimer = setTimeout(() => { deadlineExceeded = true; controller.abort(); }, overallMs);
    const address = app.server.address();
    if (!app.server.listening || !address || typeof address === 'string' || address.address !== '127.0.0.1' || signal?.aborted) throw new Error();
    // Authentication is local setup, outside timed GET workload. The owning
    // Auth instance issues the bearer, which is never logged or returned.
    const session = auth.login(key);
    transport = createApiTransport({ port: address.port, origin,
      cookie: `__Host-imsg_session=${session.cookie}`, timeoutMs });
    const cycle = createApiWorkload(path => transport.get(path, { signal: controller.signal }));
    const result = await cycle();
    if (performance.now() >= workDeadline) deadlineExceeded = true;
    if (result.outcome === 'ok' && !signal?.aborted) sample = result;
  } catch { /* Fixed result only; no upstream errors or credentials. */ }
  finally {
    clearTimeout(workTimer);
    const cleanupBudget = validDuration(cleanupMs) ? cleanupMs : 10_000;
    const cleanupDeadline = performance.now() + cleanupBudget;
    // Revoke first, so a late successful upstream response cannot be delivered.
    try { auth.revokeAll(); cleanup.revoked = auth.count === 0; } catch {}
    const attempt = async (job, field) => {
      try { await job(); cleanup[field] = true; } catch {}
    };
    // Start source cancellation even if a client socket is still shutting down.
    // Gate close provides an independent exact-child cleanup path if source
    // close rejects. A shared watchdog bounds observation, not resource lifetime.
    // Any unacknowledged close stays false; late completion cannot upgrade the
    // returned report. Do not retry or release ownership after this timeout.
    const pending = Promise.all([
      attempt(async () => { await transport?.close(); }, 'transportClosed'),
      attempt(() => source.close(), 'sourceClosed'),
      (async () => {
        try {
          const report = await readers.close();
          cleanup.readersClosed = report.allClosed === true;
          cleanup.readersNormal = report.allNormal === true && report.signalAttempted === false;
        } catch {}
      })(),
      attempt(() => app.close(), 'appClosed'),
    ]);
    let cleanupTimer;
    try {
      await Promise.race([pending, new Promise(resolve => {
        cleanupTimer = setTimeout(() => { cleanupExpired = true; resolve(); }, Math.max(0, cleanupDeadline - performance.now()));
      })]);
    } finally { clearTimeout(cleanupTimer); }
    if (performance.now() >= cleanupDeadline) cleanupExpired = true;
    if (signal instanceof AbortSignal) signal.removeEventListener('abort', abort);
  }
  const clean = !cleanupExpired && !deadlineExceeded && !interrupted && Object.values(cleanup).every(Boolean);
  return { outcome: sample && clean ? 'ok' : 'failed', gateMeasurement: false,
    sample: clean ? sample : null, interrupted, deadlineExceeded, cleanupExpired, cleanup: { ...cleanup } };
}
