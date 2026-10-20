import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Auth, hashKey, type ClientRecord } from '../src/server/auth.js';
import { createApp } from '../src/server/http.js';
import type { ChatSnapshot, ReadSource } from '../src/shared/web-types.js';
import type { AttachmentSource } from '../src/server/attachments.js';
import type { Sender } from '../src/server/send-service.js';
import { WebError } from '../src/server/web-error.js';

const ORIGIN = 'https://imsg.synthetic.test';
const HOST = 'imsg.synthetic.test';
const KEY = 'A'.repeat(43);
const READER = 'R'.repeat(43);
const WRITER = 'W'.repeat(43);
const ID = 'C'.repeat(43);
const CHAT: ChatSnapshot = { epoch: 'epoch-a', limit: 50, chats: [{ id: ID, name: 'Synthetic conversation', service: 'iMessage', isGroup: false, unreadCount: null, lastMessageAt: null, trimmed: false, preview: null, faces: [] }] };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

const records: ClientRecord[] = [
  { name: 'dashboard-read', scope: 'read', hash: hashKey(READER), created: 1 },
  { name: 'dashboard', scope: 'send', hash: hashKey(WRITER), created: 1 },
];

async function fixture() {
  let now = 1_000_000;
  const auth = new Auth(hashKey(KEY), () => now);
  auth.setClients(records);
  const source = {
    chats: vi.fn<ReadSource['chats']>(async limit => ({ ...CHAT, limit })),
    history: vi.fn<ReadSource['history']>(async () => ({ epoch: 'epoch-a', limit: 50, messages: [] })),
    capabilities: vi.fn<ReadSource['capabilities']>(async () => ({ epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' } } })),
    close: vi.fn<ReadSource['close']>(async () => {}),
    attachment: vi.fn<AttachmentSource['attachment']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
    avatar: vi.fn<ReadSource['avatar']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
  };
  const send = vi.fn<Sender['send']>(async () => ({ state: 'sent' }));
  const app = await createApp({ origins: [ORIGIN], auth, source, sender: { mode: 'live', send } });
  apps.push(app);
  const as = (token: string, extra: Record<string, string> = {}) => ({ host: HOST, authorization: `Bearer ${token}`, ...extra });
  return { app, auth, source, send, as, advance: (ms: number) => { now += ms; } };
}

describe('client tokens: other programs on the API', () => {
  it('reads with a token, without a cookie, Origin or CSRF', async () => {
    const f = await fixture();
    const chats = await f.app.inject({ url: '/api/chats', headers: f.as(READER) });
    expect(chats.statusCode).toBe(200);
    expect(chats.json<ChatSnapshot>().chats[0]!.id).toBe(ID);
    expect((await f.app.inject({ url: `/api/chats/${ID}/messages?limit=100`, headers: f.as(READER) })).statusCode).toBe(200);
    expect(f.source.history).toHaveBeenCalledWith(ID, 100);
  });

  it('turns away a token that is unknown, malformed or removed', async () => {
    const f = await fixture();
    for (const authorization of [`Bearer ${'X'.repeat(43)}`, `Bearer ${READER}x`, `Basic ${READER}`, 'Bearer'])
      expect((await f.app.inject({ url: '/api/chats', headers: { host: HOST, authorization } })).statusCode).toBe(401);
    f.auth.setClients([records[1]!]);
    expect((await f.app.inject({ url: '/api/chats', headers: f.as(READER) })).statusCode).toBe(401);
    expect((await f.app.inject({ url: '/api/chats', headers: f.as(WRITER) })).statusCode).toBe(200);
  });

  it('is never usable from a browser: Origin, Fetch Metadata or a cookie close it', async () => {
    const f = await fixture();
    for (const extra of [{ origin: ORIGIN }, { origin: 'https://dashboard.synthetic.test' }, { 'sec-fetch-site': 'same-origin' }, { cookie: '__Host-imsg_session=x' }]) {
      const response = await f.app.inject({ url: '/api/chats', headers: f.as(READER, extra) });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: 'CLIENT_FROM_BROWSER' });
    }
    expect(f.source.chats).not.toHaveBeenCalled();
  });

  it('still answers only to the Hosts the server knows', async () => {
    const f = await fixture();
    expect((await f.app.inject({ url: '/api/chats', headers: { ...f.as(READER), host: 'elsewhere.synthetic.test' } })).statusCode).toBe(403);
  });

  it('keeps a read token to reading, and every token off the owner\'s routes', async () => {
    const f = await fixture();
    const post = (token: string, url: string, payload: object) => f.app.inject({ method: 'POST', url, headers: f.as(token, { 'content-type': 'application/json' }), payload });
    expect((await post(READER, '/api/send', { chatId: ID, text: 'synthetic' })).json()).toEqual({ code: 'CLIENT_FORBIDDEN' });
    expect(f.send).not.toHaveBeenCalled();
    for (const token of [READER, WRITER]) {
      expect((await f.app.inject({ url: '/api/session', headers: f.as(token) })).statusCode).toBe(403);
      expect((await post(token, '/api/password', { password: 'synthetic1' })).statusCode).toBe(403);
      expect((await post(token, '/api/session', { key: KEY })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'DELETE', url: '/api/session', headers: f.as(token) })).statusCode).toBe(403);
    }
  });

  it('tells a read token that sending is off', async () => {
    const f = await fixture();
    const send = async (token: string) => (await f.app.inject({ url: '/api/capabilities', headers: f.as(token) })).json<{ features: Record<string, unknown> }>().features.send;
    expect(await send(READER)).toEqual({ state: 'unavailable', reasonCode: 'SEND_DISABLED' });
    expect(await send(WRITER)).toEqual({ state: 'available', reasonCode: 'SEND_READY' });
  });

  it('sends with a send token, JSON only, under its own per-minute limit', async () => {
    const f = await fixture();
    const post = (headers: Record<string, string> = {}) => f.app.inject({ method: 'POST', url: '/api/send', headers: f.as(WRITER, { 'content-type': 'application/json', ...headers }), payload: { chatId: ID, text: 'synthetic' } });
    expect((await post()).json()).toEqual({ state: 'sent' });
    expect(f.send).toHaveBeenCalledWith({ chatId: ID, text: 'synthetic' });
    expect((await post({ 'content-type': 'text/plain' })).statusCode).toBe(415);
    for (let i = 1; i < 10; i++) expect((await post()).statusCode).toBe(200);
    expect((await post()).json()).toEqual({ code: 'RATE_LIMITED' });
    // The owner's own allowance is untouched by a program's.
    const login = await f.app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, payload: { key: KEY } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const own = await f.app.inject({ method: 'POST', url: '/api/send', headers: { host: HOST, origin: ORIGIN, cookie, 'x-csrf-token': login.json<{ csrfToken: string }>().csrfToken, 'content-type': 'application/json' }, payload: { chatId: ID, text: 'synthetic' } });
    expect(own.statusCode).toBe(200);
  });

  it('limits a token to 120 requests a minute, and lets nobody in while the server is blocked', async () => {
    const f = await fixture();
    for (let i = 0; i < 120; i++) expect((await f.app.inject({ url: '/api/chats', headers: f.as(READER) })).statusCode).toBe(200);
    expect((await f.app.inject({ url: '/api/chats', headers: f.as(READER) })).statusCode).toBe(429);
    f.advance(60_000);
    expect((await f.app.inject({ url: '/api/chats', headers: f.as(READER) })).statusCode).toBe(200);
    f.auth.block();
    expect((await f.app.inject({ url: '/api/chats', headers: f.as(READER) })).statusCode).toBe(401);
  });

  it('a removed token gets nothing out of a request already under way', async () => {
    const f = await fixture();
    f.source.chats.mockImplementationOnce(async limit => { f.auth.setClients([]); return { ...CHAT, limit }; });
    const response = await f.app.inject({ url: '/api/chats', headers: f.as(READER) });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(ID);
  });
});
