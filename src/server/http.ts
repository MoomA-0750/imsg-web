import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Auth, equal, tokenValid, type Session } from './auth.js';
import { WebError } from './web-error.js';
import type { ReadSource } from '../shared/web-types.js';
import type { AttachmentSource } from './attachments.js';

const COOKIE = '__Host-imsg_session';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
export function checkedOrigin(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== 'https:' || value !== u.origin || u.username || u.password) throw new WebError('ORIGIN_INVALID');
  return u;
}
export async function createApp(options: { origin: string; auth: Auth; source: ReadSource & AttachmentSource; webDir?: string }) {
  const origin = checkedOrigin(options.origin);
  const app = Fastify({ logger: false, bodyLimit: 2048, requestTimeout: 15_000, connectionTimeout: 15_000, keepAliveTimeout: 5000, return503OnClosing: true, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(cookie);
  const authenticated = new WeakMap<object, Session>();
  let active = 0;
  app.server.maxConnections = 64;
  app.addHook('onRequest', (request, reply, done) => {
    for (const [name, value] of Object.entries({
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': CSP,
    })) reply.header(name, value);
    if (active >= 32) { reply.code(429).send({ code: 'BUSY' }); return; }
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    reply.raw.once('finish', release); reply.raw.once('close', release);
    if (request.headers.host !== origin.host || (request.headers.origin !== undefined && request.headers.origin !== origin.origin)
      || (request.url.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site')) {
      reply.code(403).send({ code: 'ORIGIN_REJECTED' }); return;
    }
    if (request.method === 'POST' || request.method === 'DELETE') {
      if (request.headers.origin !== origin.origin) { reply.code(403).send({ code: 'ORIGIN_REJECTED' }); return; }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) { reply.code(415).send({ code: 'JSON_REQUIRED' }); return; }
    }
    if (request.url.startsWith('/api/') && !(request.method === 'POST' && request.url === '/api/session')) {
      const session = options.auth.lookup(request.cookies[COOKIE]);
      if (!session) { reply.code(401).send({ code: 'UNAUTHORIZED' }); return; }
      try { options.auth.access(session); } catch (error) { done(error as Error); return; }
      authenticated.set(request, session);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const token = request.headers['x-csrf-token'];
        if (!tokenValid(token) || !equal(session.csrf, token)) { reply.code(403).send({ code: 'CSRF_REJECTED' }); return; }
      }
    }
    done();
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    const session = authenticated.get(request);
    if (session && reply.statusCode < 300 && !(request.method === 'DELETE' && request.url === '/api/session') && !options.auth.valid(session)) {
      if (payload instanceof Readable) payload.destroy(); // an attachment stream holds an open file
      reply.removeHeader('content-length').removeHeader('content-disposition').header('content-security-policy', CSP);
      reply.code(401).type('application/json'); done(null, JSON.stringify({ code: 'UNAUTHORIZED' })); return;
    }
    if ((typeof payload === 'string' || Buffer.isBuffer(payload)) && Buffer.byteLength(payload) > 4 * 1024 * 1024) {
      reply.code(413).type('application/json'); done(null, JSON.stringify({ code: 'RESPONSE_TOO_LARGE' })); return;
    }
    done(null, payload);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WebError) { reply.code(error.status).send({ code: error.code }); return; }
    const code = (error as { statusCode?: number }).statusCode;
    const status = code && code >= 400 && code < 500 ? code : 503;
    reply.code(status).send({ code: status < 500 ? 'INVALID_REQUEST' : 'READ_UNAVAILABLE' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND' }));
  app.get('/health', async () => ({ alive: true }));
  app.post('/api/session', { schema: { body: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', minLength: 43, maxLength: 43 } } } } }, async (request, reply) => {
    const { cookie: value, session } = options.auth.login((request.body as { key: string }).key);
    reply.setCookie(COOKIE, value, { path: '/', secure: true, httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400 });
    return { csrfToken: session.csrf, mode: 'readonly' };
  });
  app.get('/api/session', async request => ({ csrfToken: authenticated.get(request)!.csrf, mode: 'readonly' }));
  app.delete('/api/session', async (request, reply) => {
    options.auth.logout(authenticated.get(request)!);
    reply.clearCookie(COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
    return { ok: true };
  });
  const limit = (raw: unknown): number => {
    if (raw === undefined) return 50;
    if (typeof raw !== 'string' || !/^(?:[1-9]\d{0,2}|1000)$/.test(raw)) throw new WebError('INVALID_LIMIT', 400);
    const n = Number(raw); if (n < 50 || n > 1000 || n % 50) throw new WebError('INVALID_LIMIT', 400); return n;
  };
  app.get('/api/capabilities', async () => options.source.capabilities());
  app.get('/api/chats', async request => options.source.chats(limit((request.query as Record<string, unknown>).limit)));
  app.get('/api/chats/:id/messages', async request => {
    const id = (request.params as { id: string }).id;
    if (!tokenValid(id)) throw new WebError('STALE_CHAT', 409);
    return options.source.history(id, limit((request.query as Record<string, unknown>).limit));
  });
  app.get('/api/attachments/:id', { exposeHeadRoute: false }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!tokenValid(id)) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    const file = await options.source.attachment(id, request.headers.accept);
    // The type comes from a fixed image allowlist. The response may not run anything even if opened directly.
    return reply.type(file.type).header('content-length', file.size).header('content-disposition', 'inline')
      .header('content-security-policy', "default-src 'none'; sandbox").send(file.stream);
  });
  if (options.webDir) {
    // Enumerate generated assets, never map arbitrary URL paths to the filesystem.
    const index = await readFile(join(options.webDir, 'index.html'));
    app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').send(index));
    const assetsDir = join(options.webDir, 'assets');
    for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(?:js|css)$/.test(entry.name)) continue;
      const data = await readFile(join(assetsDir, entry.name));
      app.get(`/assets/${entry.name}`, (_request, reply) => reply.type(entry.name.endsWith('.js') ? 'text/javascript' : 'text/css').send(data));
    }
  }
  return app;
}
