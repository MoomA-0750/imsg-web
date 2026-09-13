// Outer supervisor: signals, a hard watchdog, and a report that cannot lie
// about cleanup it did not observe.
//
// The soak runner already bounds its own work and cleanup. This exists for the
// case those bounds cannot cover: a hung synchronous section, an event loop
// that stops turning, a close() that never settles. Its timers cannot preempt
// blocking code either — nothing in a single-threaded runtime can — so the
// guarantee here is deliberately weaker and stated rather than implied:
//
//   if the watchdog fires, the run is reported FAILED with ownership UNCERTAIN.
//
// Uncertain ownership is not cleaned up, not retried, and not downgraded to
// "probably fine". AGENTS.md: preserve uncertain ownership/cleanup as failure.
//
// SIGINT and SIGTERM abort the soak rather than killing the process, so its
// cleanup path runs. A second signal is not given special treatment here: the
// operator can still kill the process, and that case is exactly the one whose
// residue the supervisor must not claim to have cleaned.

const failure = (code) => Object.assign(new Error(code), { code });

export async function superviseC06({
  launch, soak,
  hardLimitMs,
  proc = process,
  now = () => performance.now(),
}) {
  if (typeof launch !== 'function' || typeof soak !== 'function') throw failure('SUPERVISE_INVALID');
  if (!Number.isInteger(hardLimitMs) || hardLimitMs < 1 || hardLimitMs > 8 * 60 * 60 * 1000) {
    throw failure('SUPERVISE_INVALID');
  }

  const controller = new AbortController();
  const signalsSeen = [];
  const onSignal = (name) => () => {
    signalsSeen.push(name);
    controller.abort();
  };
  const handlers = [['SIGINT', onSignal('SIGINT')], ['SIGTERM', onSignal('SIGTERM')]];
  for (const [name, handler] of handlers) proc.on(name, handler);

  let watchdogFired = false;
  let watchdog;
  const began = now();
  const hard = new Promise((resolve) => {
    watchdog = setTimeout(() => { watchdogFired = true; controller.abort(); resolve('watchdog'); }, hardLimitMs);
  });

  let launched = null;
  let report = null;
  let launchFailed = null;
  try {
    const work = (async () => {
      launched = await launch();
      report = await soak(launched, controller.signal);
      return 'complete';
    })();
    const outcome = await Promise.race([work.catch((e) => { launchFailed = e?.code ?? 'LAUNCH_FAILED'; return 'failed'; }), hard]);
    if (outcome === 'watchdog') {
      // The work promise is still running. It is NOT awaited and NOT abandoned
      // quietly: it keeps its rejection handler, and the report says the
      // supervisor stopped observing rather than that the work stopped.
      void work.catch(() => {});
    }
  } finally {
    clearTimeout(watchdog);
    for (const [name, handler] of handlers) proc.removeListener(name, handler);
  }

  const elapsedMs = Math.round(now() - began);
  const observedCleanup = report ? Object.values(report.cleanup ?? {}).every(Boolean) : false;

  return {
    outcome: !watchdogFired && !launchFailed && report?.outcome === 'ok' ? 'ok' : 'failed',
    gateMeasurement: false,
    watchdogFired,
    // The whole point of this field. False whenever the supervisor did not
    // watch cleanup finish, including every watchdog case.
    ownershipCertain: !watchdogFired && observedCleanup,
    launchFailed,
    signals: [...signalsSeen],
    interrupted: signalsSeen.length > 0,
    elapsedMs,
    hardLimitMs,
    admission: launched?.admission ?? null,
    report,
    // Stated so it is never inferred from a passing run.
    residueClaim: watchdogFired
      ? 'none: the supervisor stopped observing and must not be read as evidence that processes exited'
      : observedCleanup
        ? 'cleanup was observed to complete for every tracked resource'
        : 'cleanup did not complete for every tracked resource',
  };
}
