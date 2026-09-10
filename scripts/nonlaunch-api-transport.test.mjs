import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiTransport } from './nonlaunch-api-transport.mjs';

const origin = 'https://imsg.synthetic.test';
const cookie = `__Host-imsg_session=${'A'.repeat(43)}`;
const path = '/api/capabilities';
async function fixture(t, handler, options = {}) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const transport = createApiTransport({ port: server.address().port, origin, cookie, ...options });
  t.after(() => transport.close());
  return { transport, sockets };
}
const rejects = promise => assert.rejects(promise, error => error.message === 'API_TRANSPORT_FAILED');

test('GET uses exact loopback connection and supplied Host/session; closes after success', async t => {
  const f = await fixture(t, (req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, path);
    assert.equal(req.headers.host, 'imsg.synthetic.test'); assert.equal(req.headers.origin, origin);
    assert.equal(req.headers.cookie, cookie); assert.equal(req.headers.connection, 'close');
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":true}');
  });
  assert.deepEqual(await f.transport.get(path), { status: 200, data: { ok: true } });
  await f.transport.close();
  await rejects(f.transport.get(path));
});

test('rejects unsafe config and paths before issuing a request', async t => {
  for (const options of [{ port: 0 }, { origin: 'http://example.test' }, { origin: `${origin}/` }, { cookie: `${cookie}; extra=secret` }, { timeoutMs: 0 }, { maxBytes: 4194305 }]) {
    assert.throws(() => createApiTransport({ port: 1234, origin, cookie, ...options }), /API_TRANSPORT_FAILED/);
  }
  let requests = 0;
  const f = await fixture(t, () => { requests++; });
  await rejects(f.transport.get('http://example.test/api/capabilities'));
  await rejects(f.transport.get(path));
  assert.equal(requests, 0);
});

test('rejects oversized, malformed, encoded and non-JSON responses without retry', async t => {
  for (const [status, headers, body] of [
    [200, { 'content-type': 'application/json' }, '"' + 'x'.repeat(100) + '"'],
    [200, { 'content-type': 'application/json' }, 'SECRET-invalid-json'],
    [200, { 'content-type': 'text/plain' }, '{}'],
    [200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }, '{}'],
    [200, { 'content-type': 'application/json' }, Buffer.from([34, 255, 34])],
    [302, { location: 'http://example.test/SECRET' }, ''],
    [401, { 'content-type': 'application/json' }, '{}'],
  ]) {
    let requests = 0;
    const f = await fixture(t, (_req, res) => { requests++; res.writeHead(status, headers); res.end(body); }, { maxBytes: 64 });
    await rejects(f.transport.get(path)); await rejects(f.transport.get(path));
    assert.equal(requests, 1);
  }
});

test('absolute deadline cancels a response that continuously sends bytes', { timeout: 5000 }, async t => {
  let ended;
  const disconnected = new Promise(resolve => { ended = resolve; });
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('[');
    const timer = setInterval(() => res.write(' '), 5);
    res.once('close', () => { clearInterval(timer); ended(); });
  }, { timeoutMs: 100 });
  await rejects(f.transport.get(path));
  await disconnected;
  await rejects(f.transport.get(path));
});

test('abort and close cancel active work and wait for local socket closure', { timeout: 5000 }, async t => {
  for (const kind of ['abort', 'close']) {
    let entered, ended;
    const received = new Promise(resolve => { entered = resolve; });
    const disconnected = new Promise(resolve => { ended = resolve; });
    const f = await fixture(t, (_req, res) => { res.once('close', ended); entered(); });
    const controller = new AbortController();
    const running = rejects(f.transport.get(path, { signal: controller.signal }));
    await received;
    await rejects(f.transport.get(path)); // Overlap must not start another socket.
    if (kind === 'abort') controller.abort(new Error('SECRET'));
    else await f.transport.close();
    await running; await disconnected;
    await rejects(f.transport.get(path));
  }
});

test('pre-aborted signal creates no request and truncated HTTP fails closed', async t => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
    res.end('{}');
  });
  await rejects(f.transport.get(path, { signal: AbortSignal.abort() }));
  assert.equal(requests, 0);
  const g = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' }); res.end('{}');
  });
  await rejects(g.transport.get(path));
});

test('deadline also covers a server that sends no response headers', { timeout: 5000 }, async t => {
  const f = await fixture(t, () => {}, { timeoutMs: 50 });
  await rejects(f.transport.get(path));
  await f.transport.close();
  await rejects(f.transport.get(path));
});
