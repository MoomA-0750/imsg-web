import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Auth, hashKey } from '../src/server/auth.js';
import { checkedOrigin, createApp } from '../src/server/http.js';
import { Readable } from 'node:stream';
import type { ChatSnapshot, HistorySnapshot, ReadSource } from '../src/shared/web-types.js';
import type { AttachmentSource } from '../src/server/attachments.js';
import type { Sender } from '../src/server/send-service.js';
import { WebError } from '../src/server/web-error.js';

const ORIGIN = 'https://imsg.synthetic.test';
const HOST = 'imsg.synthetic.test';
const KEY = 'A'.repeat(43);
const ID = 'C'.repeat(43);
const BODY = 'SYNTHETIC_PRIVATE_BODY';
const CHAT: ChatSnapshot = { epoch: 'epoch-a', limit: 50, chats: [{ id: ID, name: 'Synthetic conversation', service: 'iMessage', isGroup: false, unreadCount: null, lastMessageAt: null, trimmed: false, preview: null, avatarId: null }] };
const HISTORY: HistorySnapshot = { epoch: 'epoch-a', limit: 50, messages: [{ id: 'D'.repeat(43), text: BODY, isFromMe: false, sender: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] };
const IMAGE_ID = 'I'.repeat(43);
const AVATAR_ID = 'V'.repeat(43);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function fixture() {
  let now = 1_000_000;
  const auth = new Auth(hashKey(KEY), () => now);
  const source = {
    chats: vi.fn<ReadSource['chats']>(async limit => ({ ...CHAT, limit })),
    history: vi.fn<ReadSource['history']>(async (_id, limit) => ({ ...HISTORY, limit })),
    capabilities: vi.fn<ReadSource['capabilities']>(async () => ({ epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' } } })),
    close: vi.fn<ReadSource['close']>(async () => {}),
    attachment: vi.fn<AttachmentSource['attachment']>(async id => {
      if (id !== IMAGE_ID) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
      return { type: 'image/png', size: PNG.length, stream: Readable.from([PNG]) };
    }),
    avatar: vi.fn<ReadSource['avatar']>(async id => {
      if (id !== AVATAR_ID) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
      return { type: 'image/png', size: PNG.length, bytes: PNG };
    }),
  };
  const app = await createApp({ origin: ORIGIN, auth, source });
  apps.push(app);
  const login = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, payload: { key: KEY } });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'] as string;
    return { response, setCookie, cookie: setCookie.split(';')[0]!, csrf: response.json<{ csrfToken: string }>().csrfToken };
  };
  return { app, auth, source, login, advance: (ms: number) => { now += ms; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('B01/B02/B07 independent HTTP acceptance (synthetic)', () => {
  it.each(['http://imsg.synthetic.test', `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?x=1`, `${ORIGIN}#fragment`, 'https://user:password@imsg.synthetic.test'])('rejects noncanonical APP_ORIGIN %s', value => {
    expect(() => checkedOrigin(value)).toThrow();
  });

  it('exposes only alive health and applies safety headers on success and rejection', async () => {
    const { app } = await fixture();
    const health = await app.inject({ url: '/health', headers: { host: HOST } });
    expect(health.json()).toEqual({ alive: true });
    const rejected = await app.inject({ url: '/api/chats', headers: { host: HOST } });
    expect(rejected.statusCode).toBe(401);
    for (const response of [health, rejected]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      // img-src additionally allows blob:, for previewing a chosen attachment; nothing else is widened.
      for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "img-src 'self' blob:", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) expect(response.headers['content-security-policy']).toContain(directive);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('does not dispatch unauthenticated reads or trust forwarded authentication', async () => {
    const { app, source } = await fixture();
    for (const url of ['/api/session', '/api/chats', `/api/chats/${ID}/messages`, '/api/capabilities']) {
      const response = await app.inject({ url, headers: { host: HOST, authorization: `Bearer ${KEY}`, 'tailscale-user-login': 'owner@synthetic.test', 'x-forwarded-user': 'owner' } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: 'UNAUTHORIZED' });
      expect(response.body).not.toContain(BODY);
    }
    expect(source.chats).not.toHaveBeenCalled();
    expect(source.history).not.toHaveBeenCalled();
    expect(source.capabilities).not.toHaveBeenCalled();
  });

  it('requires exact Host/Origin and rejects cross-site API calls even with a valid session', async () => {
    const { app, login, source } = await fixture();
    const { cookie } = await login();
    for (const extra of [
      { host: 'evil.synthetic.test', 'x-forwarded-host': HOST },
      { host: `${HOST}:443` },
      { origin: 'https://evil.synthetic.test' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await app.inject({ url: '/api/chats', headers: { host: HOST, cookie, ...extra } });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain(BODY);
    }
    expect(source.chats).not.toHaveBeenCalled();
  });

  it('requires JSON and Origin for login, rejects extra fields and invalid body shapes', async () => {
    const { app } = await fixture();
    const missingOrigin = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST }, payload: { key: KEY } });
    expect(missingOrigin.statusCode).toBe(403);
    const text = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'text/plain' }, payload: KEY });
    expect(text.statusCode).toBe(415);
    // A short key is a bad credential, not a bad request: only the shape is judged here.
    for (const payload of [{ key: KEY, extra: true }, { key: 42 }, {}, { key: '' }, { key: 'x'.repeat(257) }, [KEY], '{']) {
      const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: 'INVALID_REQUEST' });
    }
    for (const key of ['B'.repeat(43), 'short']) {
      const invalid = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key } });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.headers['set-cookie']).toBeUndefined();
    }
  });

  it('sets and clears a host-only secure HttpOnly Strict cookie and bootstraps CSRF', async () => {
    const { app, login } = await fixture();
    const { response, setCookie, cookie, csrf } = await login();
    expect(setCookie).toMatch(/^__Host-imsg_session=[A-Za-z0-9_-]{43};/);
    for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict']) expect(setCookie).toContain(attribute);
    expect(setCookie).not.toMatch(/domain=/i);
    expect(response.json()).toEqual({ csrfToken: csrf, mode: 'readonly' });
    const status = await app.inject({ url: '/api/session', headers: { host: HOST, cookie } });
    expect(status.json()).toEqual({ csrfToken: csrf, mode: 'readonly' });
    const logout = await app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, cookie, origin: ORIGIN, 'x-csrf-token': csrf }, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers['set-cookie']).toContain('__Host-imsg_session=;');
    const denied = await app.inject({ url: '/api/chats', headers: { host: HOST, cookie } });
    expect(denied.statusCode).toBe(401);
  });

  it('requires logout Origin, JSON, and this session’s CSRF token without revoking on rejected attempts', async () => {
    const { app, login } = await fixture();
    const a = await login();
    const b = await login();
    for (const token of [undefined, 'short', 'Z'.repeat(43), b.csrf]) {
      const response = await app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, cookie: a.cookie, origin: ORIGIN, ...(token ? { 'x-csrf-token': token } : {}) }, payload: {} });
      expect(response.statusCode).toBe(403);
    }
    const noOrigin = await app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, cookie: a.cookie, 'x-csrf-token': a.csrf }, payload: {} });
    expect(noOrigin.statusCode).toBe(403);
    const noJson = await app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, cookie: a.cookie, origin: ORIGIN, 'x-csrf-token': a.csrf } });
    expect(noJson.statusCode).toBe(415);
    expect((await app.inject({ url: '/api/session', headers: { host: HOST, cookie: a.cookie } })).statusCode).toBe(200);
  });

  it('rejects bodies larger than 2 KiB with a closed error', async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: KEY, padding: 'X'.repeat(2048) } });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'INVALID_REQUEST' });
  });

  it('validates history identifiers and every limit before dispatch', async () => {
    const { app, login, source } = await fixture();
    const { cookie } = await login();
    for (const value of ['0', '49', '51', '1001', '-50', '050', '50.0', '1e2', '', '50&limit=100']) {
      for (const path of ['/api/chats', `/api/chats/${ID}/messages`]) {
        const response = await app.inject({ url: `${path}?limit=${value}`, headers: { host: HOST, cookie } });
        expect(response.statusCode).toBe(400);
      }
    }
    const rawId = await app.inject({ url: '/api/chats/123/messages', headers: { host: HOST, cookie } });
    expect(rawId.statusCode).toBe(409);
    expect(source.chats).not.toHaveBeenCalled();
    expect(source.history).not.toHaveBeenCalled();
    for (const limit of [50, 100, 1000]) {
      const response = await app.inject({ url: `/api/chats/${ID}/messages?limit=${limit}`, headers: { host: HOST, cookie } });
      expect(response.statusCode).toBe(200);
      expect(source.history).toHaveBeenLastCalledWith(ID, limit);
      expect(response.json()).toEqual({ ...HISTORY, limit });
    }
  });

  it.each(['revoke', 'rotation', 'idle expiry', 'logout'] as const)('discards a successful pending history after %s', async kind => {
    const { app, login, source, auth, advance } = await fixture();
    const { cookie, csrf } = await login();
    const entered = deferred<void>();
    const result = deferred<HistorySnapshot>();
    source.history.mockImplementationOnce(async () => { entered.resolve(); return result.promise; });
    const pending = app.inject({ url: `/api/chats/${ID}/messages`, headers: { host: HOST, cookie } }).then(response => response);
    await entered.promise;
    if (kind === 'revoke') auth.revokeAll();
    if (kind === 'rotation') { auth.block(); auth.activate(hashKey('B'.repeat(43))); }
    if (kind === 'idle expiry') advance(86_400_000);
    if (kind === 'logout') expect((await app.inject({ method: 'DELETE', url: '/api/session', headers: { host: HOST, cookie, origin: ORIGIN, 'x-csrf-token': csrf }, payload: {} })).statusCode).toBe(200);
    result.resolve(HISTORY);
    const response = await pending;
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(response.body).not.toContain(BODY);
  });

  it('rejects over-4-MiB responses instead of returning a partial snapshot', async () => {
    const { app, login, source } = await fixture();
    const { cookie } = await login();
    source.history.mockResolvedValueOnce({ ...HISTORY, limit: 1000, messages: Array.from({ length: 1000 }, (_, i) => ({ ...HISTORY.messages[0]!, id: `synthetic-${i}`, text: '文'.repeat(16384) })) });
    const response = await app.inject({ url: `/api/chats/${ID}/messages?limit=1000`, headers: { host: HOST, cookie } });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('returns a closed error without raw upstream account, path, or body details', async () => {
    const { app, login, source } = await fixture();
    const { cookie } = await login();
    source.history.mockRejectedValueOnce(new Error(`/Users/synthetic/Library/Messages/chat.db owner@synthetic.test ${BODY}`));
    const response = await app.inject({ url: `/api/chats/${ID}/messages`, headers: { host: HOST, cookie } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'READ_UNAVAILABLE' });
  });

  it('provides no send, read-receipt, generic RPC, attachment-upload, or private-file endpoints', async () => {
    const { app, login, source } = await fixture();
    const { cookie, csrf } = await login();
    for (const url of ['/api/send', '/api/read', '/api/rpc', `/api/attachments/${IMAGE_ID}`]) {
      const response = await app.inject({ method: 'POST', url, headers: { host: HOST, cookie, origin: ORIGIN, 'x-csrf-token': csrf }, payload: {} });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND' });
    }
    for (const url of ['/api/attachments/1', '/api/attachments/..%2Fchat.db', '/owner.json', '/src/server/auth.ts', '/.env']) expect((await app.inject({ url, headers: { host: HOST, cookie } })).statusCode).toBe(404);
    expect(source.chats).not.toHaveBeenCalled();
    expect(source.history).not.toHaveBeenCalled();
    expect(source.attachment).not.toHaveBeenCalled();
  });

  it('serves a listed image only to a session, with a fixed type and a response that cannot run anything', async () => {
    const { app, login, source, advance } = await fixture();
    expect((await app.inject({ url: `/api/attachments/${IMAGE_ID}`, headers: { host: HOST } })).statusCode).toBe(401);
    expect(source.attachment).not.toHaveBeenCalled();
    const { cookie } = await login();
    const response = await app.inject({ url: `/api/attachments/${IMAGE_ID}`, headers: { host: HOST, cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(PNG)).toBe(true);
    expect(response.headers).toMatchObject({ 'content-type': 'image/png', 'content-length': String(PNG.length), 'content-disposition': 'inline', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
    const unknown = await app.inject({ url: `/api/attachments/${'J'.repeat(43)}`, headers: { host: HOST, cookie } });
    expect(unknown.statusCode).toBe(404); expect(unknown.json()).toEqual({ code: 'ATTACHMENT_UNAVAILABLE' });
    // A session that expires while the file is being opened gets no bytes, and the open file is released.
    const stream = Readable.from([PNG]);
    source.attachment.mockImplementationOnce(async () => { advance(8 * 86400 * 1000); return { type: 'image/png', size: PNG.length, stream }; });
    const expired = await app.inject({ url: `/api/attachments/${IMAGE_ID}`, headers: { host: HOST, cookie } });
    expect(expired.statusCode).toBe(401); expect(expired.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(expired.headers['content-security-policy']).toContain("default-src 'self'");
    expect(stream.destroyed).toBe(true);
  });

  it('enforces global 32 in-flight requests and releases slots after responses', async () => {
    const { app, login, source } = await fixture();
    const { cookie } = await login();
    const full = deferred<void>();
    const release = deferred<ChatSnapshot>();
    let count = 0;
    source.chats.mockImplementation(async () => { if (++count === 32) full.resolve(); return release.promise; });
    const pending = Array.from({ length: 32 }, () => app.inject({ url: '/api/chats', headers: { host: HOST, cookie } }).then(response => response));
    await full.promise;
    const excess = await app.inject({ url: '/api/chats', headers: { host: HOST, cookie } });
    expect(excess.statusCode).toBe(429);
    expect(excess.json()).toEqual({ code: 'BUSY' });
    release.resolve(CHAT);
    expect((await Promise.all(pending)).every(response => response.statusCode === 200)).toBe(true);
    expect((await app.inject({ url: '/health', headers: { host: HOST } })).statusCode).toBe(200);
    expect(app.server.maxConnections).toBe(64);
  });

  it('applies per-session API rates through HTTP and resets after a minute', async () => {
    const { app, login, advance } = await fixture();
    const { cookie } = await login();
    for (let i = 0; i < 120; i++) expect((await app.inject({ url: '/api/session', headers: { host: HOST, cookie } })).statusCode).toBe(200);
    const excess = await app.inject({ url: '/api/session', headers: { host: HOST, cookie } });
    expect(excess.statusCode).toBe(429);
    advance(60_000);
    expect((await app.inject({ url: '/api/session', headers: { host: HOST, cookie } })).statusCode).toBe(200);
  });

  it('limits failed login attempts through HTTP to 20 per minute', async () => {
    const { app, advance } = await fixture();
    for (let i = 0; i < 20; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: 'B'.repeat(43) } });
      expect(response.statusCode).toBe(401);
    }
    const excess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: KEY } });
    expect(excess.statusCode).toBe(429);
    expect(excess.headers['set-cookie']).toBeUndefined();
    advance(60_000);
    expect((await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN }, payload: { key: KEY } })).statusCode).toBe(200);
  });

  it('enforces authentication and Host on real loopback HTTP without exposing synthetic body to rejected requests', async () => {
    const { app, login } = await fixture();
    const { cookie } = await login();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
    // This deliberately supplies the cookie as an integration client; Secure-cookie
    // browser behavior is covered separately by the synthetic HTTPS browser suite.
    const get = (headers: Record<string, string>) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: `/api/chats/${ID}/messages`, headers }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end();
    });
    expect(address.address).toBe('127.0.0.1');
    const unauthenticated = await get({ host: HOST });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).not.toContain(BODY);
    const badHost = await get({ host: 'evil.synthetic.test', cookie, 'x-forwarded-host': HOST });
    expect(badHost.status).toBe(403);
    expect(badHost.body).not.toContain(BODY);
    const accepted = await get({ host: HOST, cookie, origin: ORIGIN });
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual(HISTORY);
  });
});


describe('B08 send endpoint (synthetic, off/dry-run/live gating)', () => {
  async function sendFixture(mode: 'off' | 'dry-run' | 'live') {
    let now = 1_000_000;
    const auth = new Auth(hashKey(KEY), () => now);
    const source = {
      chats: vi.fn<ReadSource['chats']>(async limit => ({ ...CHAT, limit })),
      history: vi.fn<ReadSource['history']>(async (_id, limit) => ({ ...HISTORY, limit })),
      capabilities: vi.fn<ReadSource['capabilities']>(async () => ({ epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' }, send: { state: 'unknown', reasonCode: 'NOT_IMPLEMENTED' } } })),
      close: vi.fn<ReadSource['close']>(async () => {}),
      attachment: vi.fn<AttachmentSource['attachment']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
      avatar: vi.fn<ReadSource['avatar']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
    };
    const send = vi.fn<Sender['send']>(async () => (mode === 'dry-run' ? { state: 'dry_run' } : { state: 'sent' }));
    const sender: Sender = { mode, send };
    const app = await createApp({ origin: ORIGIN, auth, source, sender });
    apps.push(app);
    const login = async () => {
      const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, payload: { key: KEY } });
      const setCookie = response.headers['set-cookie'] as string;
      return { cookie: setCookie.split(';')[0]!, csrf: response.json<{ csrfToken: string }>().csrfToken };
    };
    const post = (headers: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/send', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', ...headers }, payload }).then(response => response);
    return { app, send, login, post };
  }

  it('reflects the send mode in capabilities', async () => {
    for (const [mode, expected] of [['off', { state: 'unavailable', reasonCode: 'SEND_DISABLED' }], ['dry-run', { state: 'available', reasonCode: 'SEND_DRY_RUN' }], ['live', { state: 'available', reasonCode: 'SEND_READY' }]] as const) {
      const { app, login } = await sendFixture(mode);
      const { cookie } = await login();
      const caps = await app.inject({ url: '/api/capabilities', headers: { host: HOST, cookie } });
      expect(caps.json<{ features: Record<string, unknown> }>().features.send).toEqual(expected);
    }
  });

  it('does not expose the send route when sending is off', async () => {
    const { post, login } = await sendFixture('off');
    const { cookie, csrf } = await login();
    const response = await post({ cookie, 'x-csrf-token': csrf }, { chatId: 'C'.repeat(43), text: 'hi' });
    expect(response.statusCode).toBe(404);
  });

  it('requires this session CSRF token and a valid session', async () => {
    const { post, send, login } = await sendFixture('dry-run');
    const { cookie, csrf } = await login();
    expect((await post({ cookie }, { chatId: 'C'.repeat(43), text: 'hi' })).statusCode).toBe(403);
    expect((await post({ 'x-csrf-token': csrf }, { chatId: 'C'.repeat(43), text: 'hi' })).statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('dispatches a validated dry-run send and returns only the state', async () => {
    const { post, send, login } = await sendFixture('dry-run');
    const { cookie, csrf } = await login();
    const response = await post({ cookie, 'x-csrf-token': csrf }, { chatId: 'C'.repeat(43), text: 'Synthetic outgoing' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: 'dry_run' });
    expect(send).toHaveBeenCalledWith({ chatId: 'C'.repeat(43), text: 'Synthetic outgoing' });
    expect(response.body).not.toContain('Synthetic outgoing');
  });

  it('rejects malformed bodies before dispatch', async () => {
    const { post, send, login } = await sendFixture('dry-run');
    const { cookie, csrf } = await login();
    for (const payload of [{ text: 123 }, { text: '' }, { chatId: 'short', text: 'hi' }, { chatId: 'C'.repeat(43), text: 'hi', extra: 1 }, { to: 'x'.repeat(300), text: 'hi' }, { text: 'hi', uploadId: 'short' }]) {
      expect((await post({ cookie, 'x-csrf-token': csrf }, payload)).statusCode).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('limits sends per minute per session', async () => {
    const { post, login } = await sendFixture('live');
    const { cookie, csrf } = await login();
    for (let i = 0; i < 10; i++) expect((await post({ cookie, 'x-csrf-token': csrf }, { chatId: 'C'.repeat(43), text: `m${i}` })).statusCode).toBe(200);
    const eleventh = await post({ cookie, 'x-csrf-token': csrf }, { chatId: 'C'.repeat(43), text: 'm10' });
    expect(eleventh.statusCode).toBe(429);
  });
});

describe('B09 attachment upload (synthetic, binary route)', () => {
  const NAME = '写真 1.jpg';
  async function uploadFixture(mode: 'off' | 'dry-run' | 'live' = 'dry-run', maxBytes = 1024) {
    let now = 1_000_000;
    const auth = new Auth(hashKey(KEY), () => now);
    const source = {
      chats: vi.fn<ReadSource['chats']>(async limit => ({ ...CHAT, limit })),
      history: vi.fn<ReadSource['history']>(async (_id, limit) => ({ ...HISTORY, limit })),
      capabilities: vi.fn<ReadSource['capabilities']>(async () => ({ epoch: 'epoch-a', mode: 'readonly', features: {} })),
      close: vi.fn<ReadSource['close']>(async () => {}),
      attachment: vi.fn<AttachmentSource['attachment']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
      avatar: vi.fn<ReadSource['avatar']>(async () => { throw new WebError('ATTACHMENT_UNAVAILABLE', 404); }),
    };
    const accepted: { name: string | undefined; bytes: number }[] = [];
    const uploads = {
      maxBytes,
      accept: vi.fn(async (body: Readable, name: string | undefined) => {
        let bytes = 0;
        for await (const chunk of body) bytes += (chunk as Buffer).length;
        if (bytes > maxBytes) throw new WebError('UPLOAD_TOO_LARGE', 413);
        accepted.push({ name, bytes });
        return { id: 'U'.repeat(43), dir: '/tmp/u', path: `/tmp/u/${name ?? 'attachment'}`, name: name ?? 'attachment', bytes, created: 0 };
      }),
    };
    const sender: Sender = { mode, send: vi.fn<Sender['send']>(async () => ({ state: 'dry_run' })) };
    const app = await createApp({ origin: ORIGIN, auth, source, sender, uploads });
    apps.push(app);
    const login = async () => {
      const response = await app.inject({ method: 'POST', url: '/api/session', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, payload: { key: KEY } });
      const setCookie = response.headers['set-cookie'] as string;
      return { cookie: setCookie.split(';')[0]!, csrf: response.json<{ csrfToken: string }>().csrfToken };
    };
    const put = (headers: Record<string, string>, payload: string | Buffer, query = `?name=${encodeURIComponent(NAME)}`) =>
      app.inject({ method: 'POST', url: `/api/uploads${query}`, headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream', ...headers }, payload }).then(response => response);
    return { app, uploads, accepted, login, put };
  }

  it('accepts raw bytes with the owner filename and returns only an opaque id', async () => {
    const { put, accepted, login } = await uploadFixture();
    const { cookie, csrf } = await login();
    const response = await put({ cookie, 'x-csrf-token': csrf }, 'binary-bytes');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ uploadId: 'U'.repeat(43), bytes: 12, name: NAME });
    expect(accepted).toEqual([{ name: NAME, bytes: 12 }]);
    expect(response.body).not.toContain('/tmp/u'); // no path reaches the browser
  });

  it('still requires the session, this session CSRF token and the exact Origin', async () => {
    const { put, uploads, login } = await uploadFixture();
    const { cookie, csrf } = await login();
    expect((await put({ cookie }, 'x')).statusCode).toBe(403); // no CSRF header
    expect((await put({ 'x-csrf-token': csrf }, 'x')).statusCode).toBe(401); // no session
    expect((await put({ cookie, 'x-csrf-token': csrf, origin: 'https://evil.synthetic.test' }, 'x')).statusCode).toBe(403);
    expect(uploads.accept).not.toHaveBeenCalled();
  });

  it('takes only application/octet-stream, never a form encoding', async () => {
    const { put, uploads, login } = await uploadFixture();
    const { cookie, csrf } = await login();
    for (const type of ['multipart/form-data; boundary=x', 'application/x-www-form-urlencoded', 'text/plain', 'application/json']) {
      const response = await put({ cookie, 'x-csrf-token': csrf, 'content-type': type }, 'x');
      expect(response.statusCode).toBe(415);
      expect(response.json()).toEqual({ code: 'BINARY_REQUIRED' });
    }
    expect(uploads.accept).not.toHaveBeenCalled();
  });

  it('keeps every other POST JSON-only', async () => {
    const { app, login } = await uploadFixture();
    const { cookie, csrf } = await login();
    const response = await app.inject({ method: 'POST', url: '/api/send', headers: { host: HOST, origin: ORIGIN, cookie, 'x-csrf-token': csrf, 'content-type': 'application/octet-stream' }, payload: 'x' });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ code: 'JSON_REQUIRED' });
  });

  it('refuses a body past the ceiling', async () => {
    const { put, login } = await uploadFixture('dry-run', 8);
    const { cookie, csrf } = await login();
    const response = await put({ cookie, 'x-csrf-token': csrf }, Buffer.alloc(64, 1));
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'UPLOAD_TOO_LARGE' });
  });

  it('is not exposed at all when sending is off', async () => {
    const { put, login } = await uploadFixture('off');
    const { cookie, csrf } = await login();
    // With uploads disabled the route is absent, and the binary content type is no longer accepted either.
    expect((await put({ cookie, 'x-csrf-token': csrf }, 'x')).statusCode).toBe(415);
  });
});
