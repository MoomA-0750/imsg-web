const failure = () => new Error('OWNED_READER_FAILED');

// Experimental gate, not executable admission. A trusted synchronous constructor
// adapter MUST register every freshly spawned child before returning its client.
// No global spawn patch, PID lookup, process-tree kill, or live entry point.
export function createOwnedReaderGate({ graceMs = 500, killWaitMs = 1000 } = {}) {
  if (![graceMs, killWaitMs].every(n => Number.isInteger(n) && n > 0 && n <= 5000)) throw failure();
  const records = [];
  let stopped = false, constructing = false, constructionFailed = false, shutdown;
  const normal = r => r.closed && r.code === 0 && r.signal === null && !r.signalled && !r.error;
  const register = child => {
    if (!constructing || records.some(r => r.child === child)) throw failure();
    const r = { child, closed: false, closing: false, code: null, signal: null, signalled: false, error: false };
    records.push(r);
    r.done = new Promise(resolve => child.once('close', (code, signal) => {
      r.closed = true; r.code = code; r.signal = signal;
      if (!r.closing) r.error = true;
      if (!normal(r)) stopped = true;
      resolve();
    }));
    child.on('error', () => { r.error = true; stopped = true; });
    // Observe even unsuccessful signal attempts and a handler that exits zero.
    const kill = child.kill.bind(child);
    child.kill = (...args) => { r.signalled = true; stopped = true; return kill(...args); };
    child.stderr.on('data', () => { r.error = true; stopped = true; });
  };
  const factory = createClient => {
    // Exactly bootstrap + usable reader per arm; recovery is not a new sample.
    if (stopped || constructing || records.length >= 2 || !records.every(normal)) throw failure();
    const index = records.length;
    constructing = true;
    let client;
    try {
      client = createClient(register);
      if (records.length !== index + 1 || stopped) throw failure();
      const r = records[index];
      r.client = client;
      let closing;
      return {
        get closed() { return stopped || client.closed; },
        request(...args) {
          if (stopped) return Promise.reject(failure());
          return client.request(...args);
        },
        close() {
          r.closing = true;
          closing ??= (async () => {
            try { await client.close(); if (!normal(r)) throw failure(); }
            catch { stopped = true; throw failure(); }
          })();
          return closing;
        },
      };
    } catch { stopped = true; constructionFailed = true; throw failure(); }
    finally { constructing = false; }
  };
  const wait = async (r, ms) => {
    if (r.closed) return;
    let timer;
    try { await Promise.race([r.done, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    factory,
    close() {
      stopped = true;
      shutdown ??= (async () => {
        await Promise.all(records.map(async r => {
          r.closing = true;
          // Initiate client cleanup, but don't trust its promise as OS evidence.
          if (r.client) {
            r.clientSettled = false;
            try { Promise.resolve(r.client.close()).then(() => { r.clientSettled = true; }, () => { r.error = true; r.clientSettled = true; }); }
            catch { r.error = true; r.clientSettled = true; }
          }
          try {
            r.child.stdin.on('error', () => { r.error = true; });
            r.child.stdout.resume(); r.child.stderr.resume();
            r.child.stdin.end(); await wait(r, graceMs);
            if (!r.closed) { r.child.kill('SIGTERM'); await wait(r, graceMs); }
            if (!r.closed) { r.child.kill('SIGKILL'); await wait(r, killWaitMs); }
          } catch { r.error = true; }
          if (!r.closed) {
            r.child.stdin.destroy(); r.child.stdout.destroy(); r.child.stderr.destroy(); r.child.unref();
          }
        }));
        return { gateMeasurement: false, children: records.length,
          allClosed: records.every(r => r.closed),
          allNormal: !constructionFailed && records.length > 0 && records.every(r => normal(r) && r.client && r.clientSettled),
          signalAttempted: records.some(r => r.signalled) };
      })();
      return shutdown;
    },
  };
}
