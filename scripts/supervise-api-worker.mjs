import { validateSample } from './nonlaunch-sample.mjs';

// Experimental parent-side watchdog. createChild must synchronously return a
// freshly owned child with piped stdio. No PID lookup, group/descendant signalling
// or launcher is provided. Killing a worker is NOT proof its RPC children exited.
export function superviseApiWorker(createChild, { timeoutMs = 60_000, graceMs = 10_000, killWaitMs = 2000, signal } = {}) {
  if (![timeoutMs, graceMs, killWaitMs].every(n => Number.isInteger(n) && n > 0 && n <= 120_000)
    || (signal !== undefined && !(signal instanceof AbortSignal))) throw new Error('WORKER_CONFIGURATION_REJECTED');
  if (signal?.aborted) return Promise.resolve({ outcome: 'interrupted', gateMeasurement: false, workerClosed: true,
    workerCleanupReported: false, descendantStopConfirmed: false, signalAttempted: false, sample: null });
  return new Promise(resolve => {
    let child, reason, report, buffer = Buffer.alloc(0), bytes = 0;
    let stopping = false, finished = false, exited = false, signalled = false, invalidOutput = false;
    const timers = new Set();
    const later = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); };
    const finish = (closed, code = null, exitSignal = null) => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', interrupt);
      if (!closed) {
        child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy(); child?.unref();
      }
      const normal = closed && code === 0 && exitSignal === null && !signalled;
      const outcome = !closed ? 'cleanup-unconfirmed' : reason ?? (!normal ? 'exit' : !report || buffer.length ? 'protocol' : report.sessionSucceeded && report.cleanupConfirmed ? 'ok' : 'worker-failed');
      resolve({ outcome,
        gateMeasurement: false, workerClosed: closed,
        workerCleanupReported: !invalidOutput && buffer.length === 0 && report?.cleanupConfirmed === true,
        descendantStopConfirmed: false, signalAttempted: signalled, sample: outcome === 'ok' ? report?.sample ?? null : null });
    };
    const sendSignal = name => {
      // Never signal a numeric PID or an already exited worker. If pipes remain
      // open in a descendant, report uncertainty after the wait instead.
      if (!exited && child) {
        signalled = true;
        try { child.kill(name); } catch { reason ??= 'signal'; }
      }
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      try { child?.stdin.end(); } catch { reason ??= 'io'; }
      later(() => {
        if (finished) return;
        sendSignal('SIGTERM');
        later(() => {
          if (finished) return;
          sendSignal('SIGKILL'); later(() => finish(false), killWaitMs);
        }, graceMs);
      }, graceMs);
    };
    const fail = kind => { if (finished) return; reason ??= kind; stop(); };
    const interrupt = () => fail('interrupted');
    try { child = createChild(); } catch { reason = 'spawn'; finish(true); return; }
    child.once('exit', () => { exited = true; });
    child.once('close', (code, s) => finish(true, code, s));
    child.on('error', () => fail('spawn'));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => fail('io'));
    child.stderr.on('data', () => fail('stderr'));
    child.stdout.on('data', chunk => {
      // Even after timeout/abort, consume a bounded cleanup acknowledgement.
      // The failure reason remains terminal; an ACK cannot make the run succeed.
      if (finished || invalidOutput) return;
      bytes += chunk.length;
      if (bytes > 1024) { invalidOutput = true; fail('protocol'); return; }
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if (end === -1) return;
      try {
        if (report) throw new Error();
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end)));
        const keys = message && Object.keys(message).sort().join(',');
        const legacy = keys === 'cleanupConfirmed,event,sessionSucceeded';
        if (!message || (!legacy && (keys !== 'cleanupConfirmed,event,sample,sessionSucceeded,version' || message.version !== 2))
          || message.event !== 'complete' || typeof message.sessionSucceeded !== 'boolean' || typeof message.cleanupConfirmed !== 'boolean') throw new Error();
        let sample = null;
        if (!legacy) {
          if (message.sessionSucceeded && message.cleanupConfirmed) sample = validateSample(message.sample);
          else if (message.sample !== null) throw new Error();
        }
        report = { sessionSucceeded: message.sessionSucceeded, cleanupConfirmed: message.cleanupConfirmed, sample };
        buffer = buffer.subarray(end + 1);
        if (buffer.length) throw new Error();
        stop(); // The record is provisional until normal process+stdio close.
      } catch { invalidOutput = true; fail('protocol'); }
    });
    signal?.addEventListener('abort', interrupt, { once: true });
    if (signal?.aborted) interrupt();
    later(() => fail('deadline'), timeoutMs);
  });
}
