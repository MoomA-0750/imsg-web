import { afterEach, expect, it, vi } from 'vitest';
import { Auth, hashKey } from '../src/server/auth.js';
import { createApp } from '../src/server/http.js';
import type { ReadSource } from '../src/shared/web-types.js';
// @ts-expect-error Standalone Node diagnostic is JavaScript without declarations.
import { createApiWorkload } from '../scripts/nonlaunch-api-workload.mjs';
// @ts-expect-error Standalone Node diagnostic is JavaScript without declarations.
import { createApiTransport } from '../scripts/nonlaunch-api-transport.mjs';
// @ts-expect-error Standalone Node diagnostic is JavaScript without declarations.
import { runApiSession } from '../scripts/nonlaunch-api-session.mjs';

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

it('runs the workload over bounded loopback HTTP against the authenticated application', async () => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  // Test fixture owns this listener. Production supervisor admission is pending.
  const transport = createApiTransport({ port: address.port, origin: ORIGIN, cookie: f.cookie });
  try {
    const cycle = createApiWorkload(transport.get);
    expect(await cycle()).toMatchObject({ outcome: 'ok', gateMeasurement: false, chats: 1, messages: 1 });
    f.auth.revokeAll();
    expect(await cycle()).toEqual({ outcome: 'failed', phase: 'capabilities', gateMeasurement: false });
    expect(f.source.capabilities).toHaveBeenCalledTimes(1);
  } finally { await transport.close(); }
});

it.each(['ok', 'read failure', 'source close failure', 'forced reader exit', 'pre-abort'] as const)('joined session handles %s and revokes credentials', async kind => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  if (kind === 'read failure') f.source.history.mockRejectedValueOnce(new Error(BODY));
  if (kind === 'source close failure') f.source.close.mockRejectedValueOnce(new Error(BODY));
  const readers = { close: vi.fn(async () => ({ allClosed: true, allNormal: kind !== 'forced reader exit', signalAttempted: kind === 'forced reader exit' })) };
  const report = await runApiSession({ ...f, readers, key: KEY, origin: ORIGIN,
    ...(kind === 'pre-abort' ? { signal: AbortSignal.abort() } : {}) });
  expect(report.outcome).toBe(kind === 'ok' ? 'ok' : 'failed');
  expect(report.gateMeasurement).toBe(false);
  expect(report.cleanup).toMatchObject({ revoked: true, transportClosed: true, appClosed: true, readersClosed: true });
  expect(f.auth.count).toBe(0);
  expect(f.app.server.listening).toBe(false);
  expect(readers.close).toHaveBeenCalledOnce();
  expect(f.source.close).toHaveBeenCalledOnce();
  if (kind !== 'ok') expect(report.sample).toBeNull();
  if (kind === 'pre-abort') expect(f.source.capabilities).not.toHaveBeenCalled();
  for (const secret of [KEY, ID, BODY, f.cookie, f.csrf]) expect(JSON.stringify(report)).not.toContain(secret);
});

it('joined session abort interrupts pending source work as well as the HTTP socket', async () => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  let rejectHistory!: (error: Error) => void;
  f.source.history.mockImplementationOnce(() => {
    const pending = new Promise<never>((_resolve, reject) => { rejectHistory = reject; });
    controller.abort();
    return pending;
  });
  f.source.close.mockImplementationOnce(async () => { rejectHistory(new Error(BODY)); });
  const readers = { close: vi.fn(async () => ({ allClosed: true, allNormal: false, signalAttempted: true })) };
  const result = await runApiSession({ ...f, readers, key: KEY, origin: ORIGIN, signal: controller.signal });
  expect(result.outcome).toBe('failed');
  expect(result.sample).toBeNull();
  expect(result.cleanup).toMatchObject({ revoked: true, transportClosed: true, sourceClosed: true, readersClosed: true, appClosed: true });
  expect(f.auth.count).toBe(0);
  expect(f.source.close).toHaveBeenCalledOnce();
});

it('whole-cycle deadline cancels pending history before the per-request timeout', async () => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  let rejectHistory: ((error: Error) => void) | undefined;
  f.source.history.mockImplementationOnce(() => new Promise<never>((_resolve, reject) => { rejectHistory = reject; }));
  f.source.close.mockImplementationOnce(async () => { rejectHistory?.(new Error(BODY)); });
  const readers = { close: async () => ({ allClosed: true, allNormal: true, signalAttempted: false }) };
  const result = await runApiSession({ ...f, readers, key: KEY, origin: ORIGIN, timeoutMs: 2000, overallMs: 200 });
  expect(f.source.history).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ outcome: 'failed', sample: null, deadlineExceeded: true, cleanupExpired: false });
  expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  expect(f.app.server.listening).toBe(false);
});

it.each(['source', 'readers', 'app'] as const)('cleanup watchdog records unconfirmed %s closure without later upgrading its report', async kind => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const normal = { allClosed: true, allNormal: true, signalAttempted: false };
  const readers = { close: vi.fn(async () => { if (kind === 'readers') await pending; return normal; }) };
  if (kind === 'source') f.source.close.mockImplementationOnce(() => pending);
  const app = kind === 'app' ? { server: f.app.server, close: () => pending } : f.app;
  const result = await runApiSession({ ...f, app, readers, key: KEY, origin: ORIGIN, cleanupMs: 30 });
  expect(result).toMatchObject({ outcome: 'failed', sample: null, cleanupExpired: true });
  expect(result.cleanup[`${kind}Closed`]).toBe(false);
  expect(result.cleanup.revoked).toBe(true);
  expect(result.cleanup.transportClosed).toBe(true);
  expect(readers.close).toHaveBeenCalledOnce();
  const snapshot = JSON.stringify(result);
  release();
  await new Promise(resolve => setImmediate(resolve));
  expect(JSON.stringify(result)).toBe(snapshot);
});

it('invalid watchdog settings reject measurement but still clean up transferred resources', async () => {
  const f = await fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const readers = { close: vi.fn(async () => ({ allClosed: true, allNormal: true, signalAttempted: false })) };
  const result = await runApiSession({ ...f, readers, key: KEY, origin: ORIGIN, overallMs: NaN });
  expect(result.outcome).toBe('failed');
  expect(f.source.capabilities).not.toHaveBeenCalled();
  expect(result.cleanup.appClosed).toBe(true);
  expect(f.auth.count).toBe(0);
});
