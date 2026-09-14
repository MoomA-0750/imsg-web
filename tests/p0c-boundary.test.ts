import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth, hashKey } from '../src/server/auth.js';
import { createApp } from '../src/server/http.js';
import { LiveSource } from '../src/server/live-source.js';
import { ReadonlyRpcClient, type ReadMethod } from '../src/server/rpc/readonly-client.js';
import { testContext } from './helpers/child-context.js';

// Record launch configuration without replacing the real subprocess transport.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const ORIGIN = 'https://p0c.synthetic.test', HOST = 'p0c.synthetic.test', KEY = 'K'.repeat(43);
const BODY = 'P0C_SYNTHETIC_BODY';
// Independent acceptance list: deliberately not imported from implementation constants.
const ALLOWED = ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'];
const FORBIDDEN = ['send', 'read', 'typing', 'message.edit', 'message.unsend', 'message.react', 'messages.markRead', 'typing.set', 'attachments.send', 'arbitrary'];
type Audit = { pid: number; kind: 'spawn' | 'request' | 'response'; args?: string[]; method?: string; params?: Record<string, unknown>; late?: boolean };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(sip: 'enabled' | 'disabled' = 'enabled', timeoutMs?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'iw-p0c-boundary-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'imsg.mjs');
  const program = await readFile(new URL('./fixtures/p0c-imsg.mjs', import.meta.url), 'utf8');
  await writeFile(executable, program.replace(/^#![^\n]*/, `#!${process.execPath}`));
  await chmod(executable, 0o700);
  await writeFile(join(dir, 'chat.db'), 'synthetic database identity');
  await writeFile(join(dir, 'config.json'), JSON.stringify({ sip, version: sip === 'enabled' ? '0.15.1' : '0.14.2', lateOnTerm: timeoutMs !== undefined }));
  const source = new LiveSource({ context: testContext(), executable, expectedDatabasePath: join(dir, 'chat.db'), ...(timeoutMs === undefined ? {} : { factory: () => new ReadonlyRpcClient({ context: testContext(), executable, timeoutMs, shutdownGraceMs: 250 }) }) });
  cleanups.push(async () => { await unlink(join(dir, 'hold')).catch(() => {}); await source.close(); });
  const audit = async (): Promise<Audit[]> => (await readFile(join(dir, 'audit.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const historyCalls = async () => (await audit()).filter(row => row.kind === 'request' && row.method === 'messages.history');
  const auth = new Auth(hashKey(KEY));
  const app = await createApp({ origin: ORIGIN, auth, source });
  cleanups.push(() => app.close());
  const login = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: KEY } });
    expect(response.statusCode).toBe(200);
    return { cookie: (response.headers['set-cookie'] as string).split(';')[0]!, csrf: response.json<{ csrfToken: string }>().csrfToken };
  };
  const get = (cookie: string, url: string) => app.inject({ url, headers: { host: HOST, cookie } }).then(response => response);
  return { source, executable, audit, historyCalls, app, auth, login, get,
    hold: () => writeFile(join(dir, 'hold'), ''), release: () => unlink(join(dir, 'hold')) };
}

describe('P0c C02/C06 independent subprocess and HTTP boundaries', () => {
  it.each(['enabled', 'disabled'] as const)('audits every default child argv and outbound method with SIP %s, including rejected write attempts', async sip => {
    const spawnStart = vi.mocked(spawn).mock.calls.length;
    const f = await fixture(sip), session = await f.login();
    const caps = await f.get(session.cookie, '/api/capabilities');
    expect(caps.statusCode).toBe(200);
    expect(caps.json()).toMatchObject({ mode: 'readonly', features: { chats: { state: 'available' }, history: { state: 'available' }, read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' }, typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' } } });
    const chats = await f.get(session.cookie, '/api/chats?limit=50');
    expect(chats.statusCode).toBe(200);
    const id = chats.json().chats[0].id as string;
    const history = await f.get(session.cookie, `/api/chats/${id}/messages?limit=50`);
    expect(history.statusCode).toBe(200); expect(history.json().messages[0].text).toBe(BODY);
    const beforeWrites = await f.audit();
    for (const [method, url] of [
      ['POST', '/api/send'], ['POST', '/api/read'], ['POST', '/api/typing'], ['POST', '/api/rpc'],
      ['POST', `/api/chats/${id}/messages`], ['PATCH', `/api/chats/${id}/messages/1`],
      ['DELETE', `/api/chats/${id}/messages/1`], ['PUT', '/api/chats'],
    ] as const) {
      const denied = await f.app.inject({ method, url, headers: { host: HOST, origin: ORIGIN, cookie: session.cookie, 'x-csrf-token': session.csrf }, payload: { method: 'send', text: BODY } });
      expect(denied.statusCode).toBe(404); expect(denied.json()).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await f.audit()).toEqual(beforeWrites);
    const client = new ReadonlyRpcClient({ context: testContext(), executable: f.executable });
    try {
      for (const method of FORBIDDEN) await expect(client.request(method as ReadMethod, { text: BODY })).rejects.toMatchObject({ code: 'METHOD_FORBIDDEN' });
      await client.request('status');
      await client.request('watch.subscribe', { attachments: false });
      await client.request('watch.unsubscribe', { subscription: 1 });
    } finally { await client.close(); }
    await f.source.close();
    const rows = await f.audit(), spawns = rows.filter(row => row.kind === 'spawn'), requests = rows.filter(row => row.kind === 'request');
    // The two source readers name their contact source; the directly built client keeps the bare default.
    expect(spawns.map(row => row.args)).toEqual([['rpc', '--contacts-from-address-book'], ['rpc', '--contacts-from-address-book'], ['rpc']]);
    const launches = vi.mocked(spawn).mock.calls.slice(spawnStart);
    expect(launches.map(call => call[0])).toEqual(Array(3).fill(f.executable));
    expect(launches.map(call => call[1])).toEqual(spawns.map(row => row.args));
    for (const call of launches) expect(call[2]).toMatchObject({ shell: false });
    // One status for the whole UI cycle: the bootstrap's result is reused until it expires.
    expect(requests.map(row => row.method)).toEqual(['status', 'chats.list', 'messages.history', 'status', 'watch.subscribe', 'watch.unsubscribe']);
    expect(requests.filter(row => !ALLOWED.includes(row.method!))).toEqual([]);
    expect(requests.filter(row => FORBIDDEN.includes(row.method!))).toEqual([]);
    for (const row of requests) {
      const params = row.method === 'status' ? {} : row.method === 'chats.list' ? { limit: 50 } : row.method === 'messages.history' ? { chat_id: 1, limit: 50, attachments: true, convert_attachments: false } : row.method === 'watch.subscribe' ? { attachments: false } : { subscription: 1 };
      expect(row.params).toEqual(params);
    }
  });

  it('coalesces two clients across 32 delayed HTTP requests, rejects request 33, and never revives the revoked client', async () => {
    const f = await fixture();
    const chats = await f.source.chats(50), id = chats.chats[0]!.id;
    const a = await f.login(), b = await f.login();
    const sessionA = f.auth.lookup(a.cookie.split('=')[1])!, sessionB = f.auth.lookup(b.cookie.split('=')[1])!;
    await f.hold();
    const pending = Array.from({ length: 32 }, (_, i) => f.get(i % 2 ? b.cookie : a.cookie, `/api/chats/${id}/messages`));
    await vi.waitFor(() => { expect(sessionA.count).toBe(16); expect(sessionB.count).toBe(16); });
    await vi.waitFor(async () => expect(await f.historyCalls()).toHaveLength(1));
    const excess = await f.get(b.cookie, '/api/chats');
    expect(excess.statusCode).toBe(429); expect(excess.json()).toEqual({ code: 'BUSY' });
    expect(f.app.server.maxConnections).toBe(64);
    f.auth.logout(sessionA);
    await f.release();
    const results = await Promise.all(pending);
    for (const [i, response] of results.entries()) {
      expect(response.statusCode).toBe(i % 2 ? 200 : 401);
      if (i % 2) expect(response.json().messages[0].text).toBe(BODY);
      else { expect(response.json()).toEqual({ code: 'UNAUTHORIZED' }); expect(response.body).not.toContain(BODY); }
    }
    expect(await f.historyCalls()).toHaveLength(1);
    expect((await f.get(a.cookie, `/api/chats/${id}/messages`)).statusCode).toBe(401);
    // The successful client's own 120/min budget includes its 16 coalesced polls.
    for (let n = 16; n < 120; n++) expect((await f.get(b.cookie, '/api/session')).statusCode).toBe(200);
    const rate = await f.get(b.cookie, '/api/session');
    expect(rate.statusCode).toBe(429); expect(rate.json()).toEqual({ code: 'RATE_LIMITED' });
    const c = await f.login();
    expect((await f.get(c.cookie, `/api/chats/${id}/messages`)).statusCode).toBe(200);
    expect(await f.historyCalls()).toHaveLength(2);
    expect((await f.get(a.cookie, `/api/chats/${id}/messages`)).statusCode).toBe(401);
  });

  it('keeps one actual child read active plus 32 distinct waiting; duplicates at full capacity consume no slot', async () => {
    const f = await fixture(), chats = await f.source.chats(50);
    await f.hold();
    const jobs = chats.chats.slice(0, 33).map(chat => f.source.history(chat.id, 50));
    const all = Promise.all(jobs);
    await vi.waitFor(async () => expect(await f.historyCalls()).toHaveLength(1));
    expect(f.source.history(chats.chats[0]!.id, 50)).toBe(jobs[0]);
    expect(f.source.history(chats.chats[32]!.id, 50)).toBe(jobs[32]);
    await expect(f.source.history(chats.chats[33]!.id, 50)).rejects.toMatchObject({ code: 'BUSY', status: 429 });
    expect(await f.historyCalls()).toHaveLength(1);
    await f.release();
    expect((await all).map(result => result.messages[0]!.text)).toEqual(Array(33).fill(BODY));
    const events = (await f.audit()).filter(row => row.method === 'messages.history');
    expect(events.map(row => row.kind)).toEqual(Array.from({ length: 33 }, () => ['request', 'response']).flat());
    expect((await f.historyCalls()).map(row => row.params?.chat_id)).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
    await f.source.history(chats.chats[33]!.id, 50);
    expect(await f.historyCalls()).toHaveLength(34);
  });

  it('a real child timeout discards a later success and permanently invalidates old chat IDs during recovery', async () => {
    const f = await fixture('enabled', 500), old = await f.source.chats(50);
    await f.hold();
    const read = f.source.history(old.chats[0]!.id, 50);
    const outcome = read.then(value => ({ value }), error => ({ error }));
    expect(f.source.history(old.chats[0]!.id, 50)).toBe(read);
    await vi.waitFor(async () => expect(await f.historyCalls()).toHaveLength(1));
    expect(await outcome).toMatchObject({ error: { code: 'RPC_TIMEOUT' } });
    await vi.waitFor(async () => expect((await f.audit()).filter(row => row.kind === 'response' && row.late)).toHaveLength(1));
    await f.release();
    const fresh = await f.source.chats(50);
    expect(fresh.epoch).not.toBe(old.epoch);
    expect(fresh.chats[0]!.id).not.toBe(old.chats[0]!.id);
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT', status: 409 });
    expect(await f.historyCalls()).toHaveLength(1);
    expect((await f.source.history(fresh.chats[0]!.id, 50)).messages[0]!.text).toBe(BODY);
    const reads = await f.historyCalls();
    expect(reads).toHaveLength(2); expect(reads[0]!.pid).not.toBe(reads[1]!.pid);
    expect(await outcome).toMatchObject({ error: { code: 'RPC_TIMEOUT' } });
  });
});
