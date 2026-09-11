import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from './demo-preview.mjs';

test('synthetic preview: login, paging, empty history, logout and confinement', async () => {
  const server = await createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin); assert.match(await page.text(), /架空データのみ/);
    assert.equal((await fetch(`${origin}/api/chats`)).status, 401);
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"key":"demo"}' });
    assert.equal(login.status, 200);
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
    const list = await (await fetch(`${origin}/api/chats?limit=100`, { headers })).json();
    assert.equal(list.chats.length, 60);
    const empty = await (await fetch(`${origin}/api/chats/${list.chats[3].id}/messages?limit=50`, { headers })).json();
    assert.deepEqual(empty.messages, []);
    assert.equal((await fetch(`${origin}/api/chats`, { headers: { ...headers, Origin: 'http://invalid.test' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/send`, { method: 'POST', headers })).status, 405);
    assert.equal((await fetch(`${origin}/scripts/demo-preview.mjs`, { headers })).status, 404);
    const logout = await fetch(`${origin}/api/session`, { method: 'DELETE', headers: { ...headers, 'X-CSRF-Token': 'demo-only' } });
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
