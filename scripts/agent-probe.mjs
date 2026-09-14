// Manual, explicit deployment probe. No keys, cookies, IDs or bodies leave memory.
import { request } from 'node:http';
import { OwnerStore } from '../dist/server/owner-store.js';
import { adminCommand } from '../dist/server/admin.js';
const check = value => { if (!value) throw new Error(); };
let phase = 'configuration';
async function main() {
  check(process.env.IMSG_WEB_LIVE_PROBE === 'readonly-approved');
  const store = new OwnerStore(process.env.IMSG_WEB_STATE_DIR);
  const mode = process.argv[2];
  if (mode === 'setup') { await store.setup(); process.stdout.write('Private owner hash initialized; key discarded.\n'); return; }
  check(mode === 'verify');
  const origin = process.env.IMSG_WEB_ORIGIN, port = Number(process.env.IMSG_WEB_PORT);
  check(new URL(origin).origin === origin && origin.startsWith('https://') && Number.isInteger(port));
  const call = (path, cookie, method = 'GET', data, extra = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: new URL(origin).host, origin, ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...extra } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', b => { bytes += b.length; if (bytes > 4 * 1024 * 1024) req.destroy(new Error()); else chunks.push(b); });
      res.on('error', reject); res.on('end', () => { try { resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0]?.split(';')[0], data: JSON.parse(Buffer.concat(chunks).toString()) }); } catch { reject(new Error()); } });
    });
    req.setTimeout(15_000, () => req.destroy(new Error())); req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
  check((await call('/api/chats')).status === 401);
  const { key } = await adminCommand(store, 'rotate');
  const login = await call('/api/session', undefined, 'POST', { key }); check(login.status === 200 && login.cookie);
  const cookie = login.cookie;
  try {
    phase = 'http-boundaries';
    check((await call('/api/chats', cookie, 'GET', undefined, { origin: 'https://wrong.invalid' })).status === 403);
    for (const path of ['/api/send', '/api/read', '/api/typing', '/api/edit', '/api/rpc']) check((await call(path, cookie, 'POST', {}, { 'x-csrf-token': login.data.csrfToken })).status === 404);
    let selectedId;
    const cycle = async () => {
      const began = performance.now();
      phase = 'capabilities';
      const caps = await call('/api/capabilities', cookie); check(caps.status === 200 && caps.data.mode === 'readonly');
      phase = 'chats';
      const chats = await call('/api/chats?limit=50', cookie); check(chats.status === 200 && Array.isArray(chats.data.chats));
      let messages = null;
      if (chats.data.chats.length) {
        selectedId ??= chats.data.chats[0].id;
        phase = 'history';
        const history = await call(`/api/chats/${selectedId}/messages?limit=50`, cookie);
        check(history.status === 200 && history.data.epoch === chats.data.epoch && Array.isArray(history.data.messages));
        messages = history.data.messages.length;
      }
      return { elapsedMs: Math.round(performance.now() - began), chats: chats.data.chats.length, messages, read: caps.data.features.read.state, typing: caps.data.features.typing.state };
    };
    const cold = await cycle();
    process.stdout.write(JSON.stringify({ ok: true, mode, ...cold, mutationRoutesRejected: true }) + '\n');
  } finally {
    const previousPhase = phase; phase = 'session-revocation';
    await adminCommand(store, 'revoke');
    check((await call('/api/session', cookie)).status === 401);
    process.stdout.write('Probe sessions revoked.\n');
    phase = previousPhase;
  }
}
main().catch(() => { process.stderr.write(`Agent probe failed at ${phase}; details redacted.\n`); process.exitCode = 1; });
