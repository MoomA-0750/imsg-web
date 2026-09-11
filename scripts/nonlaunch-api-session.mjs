import { createApiTransport } from './nonlaunch-api-transport.mjs';
import { createApiWorkload } from './nonlaunch-api-workload.mjs';

// One synthetic/isolated session, not a live launcher. Caller transfers ownership
// of an already-listening app and its matching auth/source/reader gate. Never
// supply a production/shared app: all sessions are revoked and the app is closed.
export async function runApiSession({ app, auth, source, readers, key, origin, signal, timeoutMs = 15_000 }) {
  let transport, sample = null;
  const cleanup = { revoked: false, transportClosed: false, sourceClosed: false, readersClosed: false, readersNormal: false, appClosed: false };
  try {
    const address = app.server.address();
    if (!app.server.listening || !address || typeof address === 'string' || address.address !== '127.0.0.1' || signal?.aborted) throw new Error();
    // Authentication is local setup, outside timed GET workload. The owning
    // Auth instance issues the bearer, which is never logged or returned.
    const session = auth.login(key);
    transport = createApiTransport({ port: address.port, origin,
      cookie: `__Host-imsg_session=${session.cookie}`, timeoutMs });
    const cycle = createApiWorkload(path => transport.get(path, { signal }));
    const result = await cycle();
    if (result.outcome === 'ok' && !signal?.aborted) sample = result;
  } catch { /* Fixed result only; no upstream errors or credentials. */ }
  finally {
    // Revoke first, so a late successful upstream response cannot be delivered.
    try { auth.revokeAll(); cleanup.revoked = auth.count === 0; } catch {}
    const attempt = async (job, field) => {
      try { await job(); cleanup[field] = true; } catch {}
    };
    // Start source cancellation even if a client socket is still shutting down.
    // Gate close provides an independent exact-child cleanup path if source
    // close rejects. No Promise.race labels abandoned cleanup as completion.
    await Promise.all([
      attempt(async () => { await transport?.close(); }, 'transportClosed'),
      attempt(() => source.close(), 'sourceClosed'),
      (async () => {
        try {
          const report = await readers.close();
          cleanup.readersClosed = report.allClosed === true;
          cleanup.readersNormal = report.allNormal === true && report.signalAttempted === false;
        } catch {}
      })(),
    ]);
    await attempt(() => app.close(), 'appClosed');
  }
  const clean = Object.values(cleanup).every(Boolean);
  return { outcome: sample && clean ? 'ok' : 'failed', gateMeasurement: false,
    sample: clean ? sample : null, cleanup };
}
