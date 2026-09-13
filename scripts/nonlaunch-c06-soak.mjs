import { createApiTransport } from './nonlaunch-api-transport.mjs';
import { createApiWorkload } from './nonlaunch-api-workload.mjs';

// C06 soak: many cycles against ONE long-lived owned application, with memory
// sampled on its own clock. runApiSession is one cycle and closes the app, so
// it cannot express a soak; this does not replace or weaken it.
//
// Four defects of the historical a342425 probe are recorded in p0c-acceptance.md.
// Each one is a design constraint here, not an aspiration:
//
//   1. "nominal 15-second polling and 5-second RSS sampling share a serial loop,
//      so reads add scheduling jitter" -> memory sampling runs on an independent
//      timer and never awaits a cycle.
//   2. "short-lived CLI children can be missed by RSS snapshots" -> children are
//      sampled by the pids the reader gate registered, and a miss is reported as
//      a miss. Sampling cannot prove the absence of a transient child, and this
//      module does not claim otherwise.
//   3. "did not persist the 20 raw cycle timings" -> every cycle record is
//      returned, including per-stage timings. Summaries are derived from them,
//      never instead of them.
//   4. "The reported duration is the requested duration, not an independently
//      saved actual elapsed time" -> actualElapsedMs is measured. The requested
//      duration is echoed separately so the two can never be confused.
//
// Slots are absolute, not "wait intervalMs after the last one finished": a slow
// cycle must not silently stretch the schedule. A slot whose predecessor is
// still running is recorded as skipped and never queued.
//
// Never hand this a production or shared application. It revokes every session
// and closes what it is given.

const round = value => Math.round(value * 10) / 10;

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return round(sorted[index]);
}

function summarise(values) {
  return values.length === 0 ? null : {
    n: values.length,
    median: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

export async function runC06Soak({
  app, auth, source, readers, key, origin, signal,
  durationMs = 1_800_000, intervalMs = 15_000, rssIntervalMs = 5_000,
  timeoutMs = 15_000, cleanupMs = 10_000,
  sampleRss, selfRss = () => process.memoryUsage.rss(),
  now = () => performance.now(),
}) {
  const positive = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
  const valid = positive(durationMs, 6 * 60 * 60 * 1000) && positive(intervalMs, 600_000)
    && positive(rssIntervalMs, 600_000) && positive(cleanupMs, 60_000)
    && intervalMs <= durationMs && rssIntervalMs <= durationMs;

  const controller = new AbortController();
  const cycles = [];
  const rss = [];
  let transport, cycleTimer, rssTimer;
  let interrupted = false, reachedDuration = false, cleanupExpired = false;
  let skippedSlots = 0, rssMisses = 0, configInvalid = false, startupFailed = false;
  let actualElapsedMs = 0;
  const cleanup = { revoked: false, transportClosed: false, sourceClosed: false,
    readersClosed: false, readersNormal: false, appClosed: false };
  const abort = () => { interrupted = true; controller.abort(); };

  try {
    if (!valid || (signal !== undefined && !(signal instanceof AbortSignal))) {
      configInvalid = true;
      throw new Error();
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();

    const address = app.server.address();
    if (!app.server.listening || !address || typeof address === 'string'
      || address.address !== '127.0.0.1' || signal?.aborted) {
      startupFailed = true;
      throw new Error();
    }

    const session = auth.login(key);
    transport = createApiTransport({ port: address.port, origin,
      cookie: `__Host-imsg_session=${session.cookie}`, timeoutMs });
    const cycle = createApiWorkload(path => transport.get(path, { signal: controller.signal }), now);

    const began = now();
    const deadline = began + durationMs;

    // Memory, on its own clock. It must never await a cycle: that coupling is
    // exactly what made the old probe's timings unusable.
    const takeRss = () => {
      const pids = typeof readers?.livePids === 'function' ? readers.livePids() : [];
      let children = null;
      try {
        children = typeof sampleRss === 'function' ? sampleRss(pids) : null;
      } catch { children = null; }
      if (pids.length > 0 && (children === null || pids.some(p => !children.has(p)))) rssMisses += 1;
      const childTotal = children === null ? 0
        : [...children.values()].reduce((a, b) => a + b, 0);
      rss.push({ at: round(now() - began), selfKb: Math.round(selfRss() / 1024),
        childKb: childTotal, children: pids.length });
    };
    takeRss();
    rssTimer = setInterval(takeRss, rssIntervalMs);

    let running = false;
    let slot = 0;
    await new Promise(resolve => {
      const finish = () => { clearInterval(cycleTimer); resolve(); };
      const fire = async () => {
        if (controller.signal.aborted) return finish();
        if (now() >= deadline) return finish();
        if (running) { skippedSlots += 1; return; }
        running = true;
        const index = slot;
        slot += 1;
        const startedAt = round(now() - began);
        let result;
        try { result = await cycle(); } catch { result = { outcome: 'failed', phase: 'transport' }; }
        running = false;
        cycles.push({ index, startedAt, cold: index === 0, ...result });
        // A failed cycle is terminal for the workload helper, so continuing
        // would only accumulate `unavailable`. Stop and report what happened.
        if (result.outcome !== 'ok') return finish();
        if (now() >= deadline) return finish();
      };
      cycleTimer = setInterval(fire, intervalMs);
      void fire();
      controller.signal.addEventListener('abort', finish, { once: true });
    });
    clearInterval(cycleTimer);
    actualElapsedMs = round(now() - began);
    // Reaching the requested duration is the SUCCESS case for a soak, not a
    // deadline breach. Stopping short of it means something ended the run early
    // -- an abort, or a failed cycle -- and that is what needs reporting.
    reachedDuration = actualElapsedMs >= durationMs;
  } catch { /* fixed report only */ }
  finally {
    clearInterval(cycleTimer);
    clearInterval(rssTimer);
    const cleanupBudget = positive(cleanupMs, 60_000) ? cleanupMs : 10_000;
    const cleanupDeadline = now() + cleanupBudget;
    try { auth.revokeAll(); cleanup.revoked = auth.count === 0; } catch {}
    const attempt = async (job, field) => { try { await job(); cleanup[field] = true; } catch {} };
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
        cleanupTimer = setTimeout(() => { cleanupExpired = true; resolve(); },
          Math.max(0, cleanupDeadline - now()));
      })]);
    } finally { clearTimeout(cleanupTimer); }
    if (now() >= cleanupDeadline) cleanupExpired = true;
    if (signal instanceof AbortSignal) signal.removeEventListener('abort', abort);
  }

  const ok = cycles.filter(c => c.outcome === 'ok');
  const warm = ok.filter(c => !c.cold);
  const clean = !cleanupExpired && !interrupted && !configInvalid && !startupFailed
    && Object.values(cleanup).every(Boolean);
  const failedCycles = cycles.filter(c => c.outcome !== 'ok').length;

  return {
    outcome: clean && failedCycles === 0 && warm.length > 0 ? 'ok' : 'failed',
    // Never a pass on its own. C06 acceptance is a separate judgement made
    // against thresholds that this module does not know and must not apply.
    gateMeasurement: false,
    requestedDurationMs: durationMs,
    actualElapsedMs,
    intervalMs,
    rssIntervalMs,
    cyclesAttempted: cycles.length,
    cyclesOk: ok.length,
    failedCycles,
    skippedSlots,
    coldCycleMs: cycles.find(c => c.cold && c.outcome === 'ok')?.cycleMs ?? null,
    warm: {
      cycleMs: summarise(warm.map(c => c.cycleMs)),
      capabilitiesMs: summarise(warm.map(c => c.capabilitiesMs)),
      chatsMs: summarise(warm.map(c => c.chatsMs)),
      historyMs: summarise(warm.map(c => c.historyMs)),
    },
    rssSamples: rss.length,
    rssMisses,
    rssSelfMaxKb: rss.length ? Math.max(...rss.map(s => s.selfKb)) : null,
    rssChildMaxKb: rss.length ? Math.max(...rss.map(s => s.childKb)) : null,
    // Raw records, because summaries computed instead of keeping them is the
    // mistake this project already made once.
    records: cycles,
    rssRecords: rss,
    interrupted, reachedDuration, cleanupExpired, configInvalid, startupFailed,
    cleanup: { ...cleanup },
  };
}
