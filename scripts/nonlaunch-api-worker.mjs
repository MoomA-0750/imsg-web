import { runApiSession } from './nonlaunch-api-session.mjs';
import { validateSample } from './nonlaunch-sample.mjs';

// Trusted entry-point adapter, not an admitted launcher. start must promptly
// observe signal during setup and register partial resources for cleanupStartup.
// The outer watchdog, not this event loop, owns the final startup deadline.
export async function runApiWorker({ start, cleanupStartup }, { input = process.stdin, output = process.stdout, signals = process } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let sessionStarted = false, sessionSucceeded = false, cleanupConfirmed = false, sample = null;
  const names = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  input.on('end', abort); input.on('error', abort);
  // Parent protocol is EOF only; unexpected input also cancels rather than
  // interpreting arbitrary commands or credentials.
  input.on('data', abort);
  for (const name of names) signals.on(name, abort);
  input.resume();
  if (input.readableEnded || input.destroyed) abort();
  try {
    const resources = await start(controller.signal);
    sessionStarted = true;
    const result = await runApiSession({ ...resources, signal: controller.signal });
    sessionSucceeded = result.outcome === 'ok' && !controller.signal.aborted;
    cleanupConfirmed = result.cleanupExpired === false && Object.values(result.cleanup).every(value => value === true);
    if (sessionSucceeded && cleanupConfirmed) {
      const s = result.sample;
      sample = validateSample({ capabilitiesMs: s.capabilitiesMs, chatsMs: s.chatsMs, historyMs: s.historyMs,
        cycleMs: s.cycleMs, chats: s.chats, messages: s.messages, nonemptyHistory: s.nonemptyHistory });
    }
  } catch { sessionSucceeded = false; sample = null; /* Never forward errors. */ }
  finally {
    if (!sessionStarted) {
      try { cleanupConfirmed = await cleanupStartup() === true; } catch {}
    }
    input.off('end', abort); input.off('error', abort); input.off('data', abort);
    for (const name of names) signals.off(name, abort);
    input.destroy();
  }
  const record = { event: 'complete', version: 2, sessionSucceeded, cleanupConfirmed, sample };
  // Await flush; failure returns false flags without falling back to raw logging.
  const ignoreOutputError = () => {};
  output.on('error', ignoreOutputError);
  try {
    await new Promise((resolve, reject) => output.write(`${JSON.stringify(record)}\n`, error => error ? reject(error) : resolve()));
  } catch { return { event: 'complete', version: 2, sessionSucceeded: false, cleanupConfirmed: false, sample: null }; }
  finally { output.off('error', ignoreOutputError); }
  return record;
}
