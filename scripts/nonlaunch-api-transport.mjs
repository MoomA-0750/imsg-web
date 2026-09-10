import { request } from 'node:http';

const failed = () => new Error('API_TRANSPORT_FAILED');
const allowedPath = path => typeof path === 'string' && (
  path === '/api/capabilities' || path === '/api/chats?limit=50'
  || /^\/api\/chats\/[A-Za-z0-9_-]{43}\/messages\?limit=50$/.test(path)
);

// Experimental GET-only transport. Caller must prove listener/process ownership
// before supplying a session cookie. Loopback alone does not establish ownership.
// No login, redirects, proxy, retry, logging, CLI entry point or persistent agent.
export function createApiTransport({ port, origin, cookie, timeoutMs = 15_000, maxBytes = 4 * 1024 * 1024 }) {
  let url;
  try { url = new URL(origin); } catch { throw failed(); }
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || url.protocol !== 'https:' || url.origin !== origin || url.username || url.password
    || !/^__Host-imsg_session=[A-Za-z0-9_-]{43}$/.test(cookie)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024) throw failed();
  let stopped = false, active;
  const get = async (path, { signal } = {}) => {
    if (stopped || active) throw failed();
    if (!allowedPath(path) || (signal !== undefined && !(signal instanceof AbortSignal)) || signal?.aborted) {
      stopped = true; throw failed();
    }
    let cancel;
    const pending = new Promise((resolve, reject) => {
      let req, socket, timer, response, result;
      let requestClosed = false, socketClosed = true, bad = false, ended = false;
      let chunks = [], size = 0;
      const deadline = performance.now() + timeoutMs;
      const settle = () => {
        if (!requestClosed || !socketClosed) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (bad || !ended) { stopped = true; reject(failed()); }
        else resolve(result);
      };
      const abort = () => {
        bad = true; stopped = true; chunks = [];
        response?.destroy(); req?.destroy(); socket?.destroy();
      };
      cancel = abort;
      try {
        req = request({ hostname: '127.0.0.1', port, method: 'GET', path,
          agent: false, maxHeaderSize: 16 * 1024,
          headers: { host: url.host, origin, cookie, connection: 'close', accept: 'application/json' },
        }, incoming => {
          response = incoming;
          incoming.on('error', abort);
          incoming.on('aborted', abort);
          if (incoming.statusCode !== 200 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(incoming.headers['content-type'] ?? '')
            || (incoming.headers['content-encoding'] !== undefined && incoming.headers['content-encoding'] !== 'identity')) { abort(); return; }
          incoming.on('data', chunk => {
            if (bad) return;
            size += chunk.length;
            if (size > maxBytes || performance.now() >= deadline) { abort(); return; }
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            if (bad) return;
            try {
              if (!incoming.complete || performance.now() >= deadline) throw failed();
              const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
              if (performance.now() >= deadline) throw failed();
              result = { status: 200, data }; ended = true;
            } catch { abort(); }
            chunks = [];
          });
        });
        req.on('socket', owned => {
          socket = owned; socketClosed = false;
          owned.once('close', () => { socketClosed = true; settle(); });
          if (bad) owned.destroy();
        });
        req.on('error', abort);
        req.once('close', () => { requestClosed = true; settle(); });
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, timeoutMs);
        req.end();
      } catch {
        abort();
        if (!req) { requestClosed = true; settle(); }
      }
    });
    active = { pending, cancel: () => cancel() };
    try { return await pending; } finally { active = undefined; }
  };
  return {
    get,
    async close() {
      stopped = true;
      const current = active;
      if (current) { current.cancel(); await current.pending.catch(() => {}); }
    },
  };
}
