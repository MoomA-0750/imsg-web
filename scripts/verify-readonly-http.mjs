// Explicit manual real-device probe; never run automatically by npm test.
// Reads up to50 chats and50 messages from one chat in memory. No mutation methods.
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { OwnerStore } from '../dist/server/owner-store.js';
import { LiveSource } from '../dist/server/live-source.js';
import { startRuntime } from '../dist/server/runtime.js';
import { adminCommand } from '../dist/server/admin.js';
async function main() {
  if (process.env.IMSG_WEB_LIVE_PROBE !== 'readonly-approved' || !process.env.IMSG_WEB_IMSG_PATH) throw new Error();
  const root = await mkdtemp(join(tmpdir(), 'iw-live-'));
  const store = new OwnerStore(join(root, 'state')), key = await store.setup();
  const runtime = await startRuntime({ store, source: new LiveSource({ executable: process.env.IMSG_WEB_IMSG_PATH }), origin: 'https://probe.invalid', port: 0, webDir: new URL('../dist/web', import.meta.url).pathname });
  const port = runtime.app.server.address().port;
  const call = (path, method = 'GET', cookie, payload) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { host: 'probe.invalid', origin: 'https://probe.invalid', ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => { try { resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0]?.split(';')[0], data: path === '/' ? Buffer.concat(chunks).toString() : JSON.parse(Buffer.concat(chunks).toString()) }); } catch { reject(new Error()); } });
    });
    req.setTimeout(30_000, () => req.destroy(new Error())); req.on('error', reject); req.end(payload ? JSON.stringify(payload) : undefined);
  });
  let summary;
  try {
    const started = performance.now();
    if ((await call('/api/chats')).status !== 401) throw new Error();
    if ((await call('/')).status !== 200) throw new Error();
    const login = await call('/api/session', 'POST', undefined, { key });
    if (login.status !== 200 || !login.cookie) throw new Error();
    const caps = await call('/api/capabilities', 'GET', login.cookie);
    if (caps.status !== 200 || caps.data.features.chats.state !== 'available') throw new Error();
    const chats = await call('/api/chats?limit=50', 'GET', login.cookie);
    if (chats.status !== 200 || !Array.isArray(chats.data.chats)) throw new Error();
    let messages = null;
    if (chats.data.chats.length) {
      const history = await call(`/api/chats/${chats.data.chats[0].id}/messages?limit=50`, 'GET', login.cookie);
      if (history.status !== 200 || history.data.epoch !== chats.data.epoch || !Array.isArray(history.data.messages)) throw new Error();
      messages = history.data.messages.length;
    }
    await adminCommand(store, 'revoke');
    if ((await call('/api/chats', 'GET', login.cookie)).status !== 401) throw new Error();
    summary = { ok: true, node: process.versions.node, arch: process.arch, authenticated: true, chats: chats.data.chats.length, messages, read: caps.data.features.read.state, typing: caps.data.features.typing.state, elapsedMs: Math.round(performance.now() - started), revoked: true };
  } finally { await runtime.close(); }
  process.stdout.write(`${JSON.stringify({ ...summary, shutdown: 'confirmed', sent: 0, readStateChanges: 0 })}\n`);
}
main().catch(() => { process.stderr.write('Read-only HTTP probe failed (details redacted).\n'); process.exitCode = 1; });
