import { afterEach, expect, it, vi } from 'vitest';
import { Auth, hashKey } from '../src/server/auth.js';
import { createApp } from '../src/server/http.js';
import type { ReadSource } from '../src/shared/web-types.js';
// @ts-expect-error Standalone Node diagnostic is JavaScript without declarations.
import { createApiWorkload } from '../scripts/nonlaunch-api-workload.mjs';

const HOST = 'imsg.synthetic.test', ORIGIN = `https://${HOST}`;
const KEY = 'A'.repeat(43), ID = 'C'.repeat(43), BODY = 'SYNTHETIC_PRIVATE_BODY';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

async function fixture() {
  const auth = new Auth(hashKey(KEY));
  const source = {
    capabilities: vi.fn<ReadSource['capabilities']>(async () => ({ epoch: 'epoch-a', mode: 'readonly', features: {
      chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' },
      read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' }, typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
    } })),
    chats: vi.fn<ReadSource['chats']>(async limit => ({ epoch: 'epoch-a', limit, chats: [{ id: ID, name: 'SYNTHETIC_PRIVATE_NAME', service: 'iMessage', isGroup: false, unreadCount: null, lastMessageAt: null, trimmed: false }] })),
    history: vi.fn<ReadSource['history']>(async (_id, limit) => ({ epoch: 'epoch-a', limit, messages: [{ id: 'D'.repeat(43), text: BODY, isFromMe: false, createdAt: null, trimmed: false }] })),
    close: vi.fn<ReadSource['close']>(async () => {}),
  };
  const app = await createApp({ origin: ORIGIN, auth, source });
  cleanup.push(async () => { auth.revokeAll(); try { await app.close(); } finally { await source.close(); } });
  const login = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: KEY } });
  expect(login.statusCode).toBe(200);
  const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
  const csrf = login.json<{ csrfToken: string }>().csrfToken;
  const paths: string[] = [];
  // In-process injection tests the real routing/auth/serialization, not TCP,
  // transport deadlines, Secure-cookie browser enforcement, or owned RPC exit.
  const cycle = createApiWorkload(async (url: string) => {
    paths.push(url);
    const response = await app.inject({ url, headers: { host: HOST, cookie } });
    return { status: response.statusCode, data: response.json() };
  });
  return { app, auth, source, cycle, paths, cookie, csrf };
}

it('runs the workload through authenticated production routes and revokes its session', async () => {
  const f = await fixture();
  const result = await f.cycle();
  expect(result).toMatchObject({ outcome: 'ok', gateMeasurement: false, chats: 1, messages: 1, nonemptyHistory: true });
  expect(f.paths).toEqual(['/api/capabilities', '/api/chats?limit=50', `/api/chats/${ID}/messages?limit=50`]);
  expect(f.source.history).toHaveBeenCalledWith(ID, 50);
  for (const secret of [KEY, ID, BODY, 'SYNTHETIC_PRIVATE_NAME', 'epoch-a', f.cookie, f.csrf]) expect(JSON.stringify(result)).not.toContain(secret);
  const logout = await f.app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, origin: ORIGIN, cookie: f.cookie, 'x-csrf-token': f.csrf }, payload: {} });
  expect(logout.statusCode).toBe(200);
  expect(f.auth.count).toBe(0);
  expect(await f.cycle()).toEqual({ outcome: 'failed', phase: 'capabilities', gateMeasurement: false });
  expect(f.source.capabilities).toHaveBeenCalledTimes(1);
});

it('does not dispatch reads with a revoked session and never retries a failed cycle', async () => {
  const f = await fixture();
  f.auth.revokeAll();
  expect(await f.cycle()).toEqual({ outcome: 'failed', phase: 'capabilities', gateMeasurement: false });
  expect(await f.cycle()).toEqual({ outcome: 'unavailable', gateMeasurement: false });
  expect(f.paths).toEqual(['/api/capabilities']);
  expect(f.source.capabilities).not.toHaveBeenCalled();
  expect(f.source.chats).not.toHaveBeenCalled();
  expect(f.source.history).not.toHaveBeenCalled();
});

it('rejects a pending history result if authentication expires before serialization', async () => {
  const f = await fixture();
  const history = await f.source.history(ID, 50);
  f.source.history.mockClear();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.source.history.mockImplementationOnce(async () => { entered(); await pending; return history; });
  const running = f.cycle();
  await waiting;
  try { f.auth.revokeAll(); } finally { release(); }
  expect(await running).toEqual({ outcome: 'failed', phase: 'history', gateMeasurement: false });
  expect(await f.cycle()).toEqual({ outcome: 'unavailable', gateMeasurement: false });
  expect(f.source.history).toHaveBeenCalledTimes(1);
});

it('stops on a real API error without exposing upstream details or reading history', async () => {
  const f = await fixture();
  f.source.chats.mockRejectedValueOnce(new Error(`${BODY} /Users/synthetic/Library/Messages/chat.db`));
  expect(await f.cycle()).toEqual({ outcome: 'failed', phase: 'chats', gateMeasurement: false });
  expect(await f.cycle()).toEqual({ outcome: 'unavailable', gateMeasurement: false });
  expect(f.source.chats).toHaveBeenCalledTimes(1);
  expect(f.source.history).not.toHaveBeenCalled();
});
