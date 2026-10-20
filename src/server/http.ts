import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { readFile, readdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Auth, PASSWORD_MAX, equal, passwordProblem, tokenValid, type Session } from './auth.js';
import { WebError } from './web-error.js';
import type { ReadSource } from '../shared/web-types.js';
import type { AttachmentSource } from './attachments.js';
import type { Sender } from './send-service.js';
import type { Upload } from './uploads.js';
import { sendCapability } from './capabilities.js';

/** What the HTTP layer needs of the upload store. */
export interface UploadSink { accept(body: Readable, name: string | undefined, voice?: boolean): Promise<Upload>; readonly maxBytes: number }

const COOKIE = '__Host-imsg_session';
// `blob:` in img-src and media-src is only for playing back an attachment or a recording the owner
// just made: a blob URL can only be minted by this page for its own data, so it admits no
// third-party content. Everything else stays 'self'.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
// The microphone is the one device this page asks for, and only when the owner starts a recording.
// Naming the rest closes them to this page and anything it could ever embed.
const PERMISSIONS = 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), midi=(), display-capture=()';
/**
 * A single `bytes=` range, the only form a media player sends. Undefined means the whole thing:
 * anything unparseable is answered in full rather than argued with, which is what a server that
 * does not recognise a range header would do anyway.
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!match || size === 0) return undefined;
  const [, from, to] = match;
  if (from === '' && to === '') return undefined;
  // `bytes=-500`: the last 500 bytes.
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined;
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * Every address is https, loopback included: the server carries its own TLS, so there is one way
 * to reach it and one rule for it. Something in front (Tailscale Serve) brings its own certificate
 * and is named here by its https address too.
 */
export function checkedOrigin(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== 'https:' || value !== u.origin || u.username || u.password) throw new WebError('ORIGIN_INVALID');
  return u;
}
/**
 * The address on the local network: the Mac's own `.local` name with the port spelled out. A name,
 * so the exact Origin and Host checks still have one thing to compare against.
 */
export function checkedLanOrigin(value: string): URL {
  const u = checkedOrigin(value);
  if (!u.port || !/^[a-z0-9-]{1,63}\.local$/.test(u.hostname)) throw new WebError('ORIGIN_INVALID');
  return u;
}
/** This machine's own IPv4 addresses on its networks, as they are now. */
export function localAddresses(): string[] {
  return Object.values(networkInterfaces()).flat().flatMap(a => a && a.family === 'IPv4' && !a.internal ? [a.address] : []);
}
export async function createApp(options: { origins: string[]; lanOrigin?: string; addresses?: () => string[]; tls?: { cert: Buffer; key: Buffer }; auth: Auth; setPassword?: (password: string) => Promise<void>; source: ReadSource & AttachmentSource; sender?: Sender; uploads?: UploadSink; webDir?: string }) {
  const named = options.origins.map(checkedOrigin);
  const lan = options.lanOrigin === undefined ? undefined : checkedLanOrigin(options.lanOrigin);
  const addresses = options.addresses ?? localAddresses;
  // Each Host this answers to, and the one Origin that goes with it. A request is held to the
  // origin its own Host names, so the checks stay exact however many ways in there are.
  const origins = new Map([...named, ...(lan ? [lan] : [])].map(u => [u.host, u.origin] as const));
  const originFor = (host: string | undefined): string | undefined => {
    if (host === undefined) return undefined;
    const known = origins.get(host);
    if (known || !lan) return known;
    // The LAN port by the Mac's own address, too: not every phone resolves `.local` names. Only
    // addresses this machine has right now, so a name pointed here by someone else's DNS is not one.
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(host);
    return match && match[2] === lan.port && addresses().includes(match[1]!) ? `https://${host}` : undefined;
  };
  const settings = { logger: false, bodyLimit: 2048, requestTimeout: 15_000, connectionTimeout: 15_000, keepAliveTimeout: 5000, return503OnClosing: true, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } } as const;
  // The same app either way; only the server under it differs, which is why the https one is typed
  // as the plain one. Tests drive it through inject() and need no certificate.
  const app = options.tls ? Fastify({ ...settings, https: options.tls }) as unknown as FastifyInstance : Fastify(settings);
  await app.register(cookie);
  const authenticated = new WeakMap<object, Session>();
  const uploadsEnabled = Boolean(options.uploads && options.sender && options.sender.mode !== 'off');
  let active = 0;
  app.server.maxConnections = 64;
  app.addHook('onRequest', (request, reply, done) => {
    for (const [name, value] of Object.entries({
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': CSP, 'permissions-policy': PERMISSIONS,
    })) reply.header(name, value);
    if (active >= 32) { reply.code(429).send({ code: 'BUSY' }); return; }
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    reply.raw.once('finish', release); reply.raw.once('close', release);
    const expected = originFor(request.headers.host);
    if (!expected || (request.headers.origin !== undefined && request.headers.origin !== expected)
      || (request.url.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site')) {
      reply.code(403).send({ code: 'ORIGIN_REJECTED' }); return;
    }
    if (request.method === 'POST' || request.method === 'DELETE') {
      if (request.headers.origin !== expected) { reply.code(403).send({ code: 'ORIGIN_REJECTED' }); return; }
      // Attachment upload is the one binary route. `application/octet-stream` cannot come from an
      // HTML form (unlike multipart or urlencoded), so the exact Origin and the CSRF header below
      // still carry the whole CSRF defence; every other POST stays JSON-only.
      const binary = uploadsEnabled && request.method === 'POST' && request.url.split('?')[0] === '/api/uploads';
      const type = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const acceptable = binary ? type === 'application/octet-stream' : /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '');
      if (!acceptable) { reply.code(415).send({ code: binary ? 'BINARY_REQUIRED' : 'JSON_REQUIRED' }); return; }
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
    // Signing out and setting a first password both end the session that asked, on purpose.
    if (session && reply.statusCode < 300 && !(request.method === 'DELETE' && request.url === '/api/session') && !(request.method === 'POST' && request.url === '/api/password') && !options.auth.valid(session)) {
      if (payload instanceof Readable) payload.destroy(); // an attachment stream holds an open file
      reply.removeHeader('content-length').removeHeader('content-disposition').header('content-security-policy', CSP);
      reply.code(401).type('application/json'); done(null, JSON.stringify({ code: 'UNAUTHORIZED' })); return;
    }
    if ((typeof payload === 'string' || Buffer.isBuffer(payload)) && Buffer.byteLength(payload) > 4 * 1024 * 1024) {
      reply.code(413).type('application/json'); done(null, JSON.stringify({ code: 'RESPONSE_TOO_LARGE' })); return;
    }
    done(null, payload);
  });
  app.setErrorHandler((error, request, reply) => {
    const refused = (status: number, code: string) => {
      // Sending is the one thing whose failures leave no trace anywhere else, so the two routes it
      // needs say so. The path only — never the query, the body, or who it was for.
      const path = request.url.split('?')[0]!;
      if (path === '/api/send' || path === '/api/uploads') console.error(`${new Date().toISOString()} send trouble: refused ${path} status=${status} code=${code}`);
    };
    if (error instanceof WebError) { refused(error.status, error.code); reply.code(error.status).send({ code: error.code }); return; }
    const code = (error as { statusCode?: number }).statusCode;
    const status = code && code >= 400 && code < 500 ? code : 503;
    const shown = status < 500 ? 'INVALID_REQUEST' : 'READ_UNAVAILABLE';
    refused(status, shown);
    reply.code(status).send({ code: shown });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND' }));
  app.get('/health', async () => ({ alive: true }));
  // Wide enough for a chosen password, bounded so a long one cannot make the server derive for ever.
  app.post('/api/session', { schema: { body: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX } } } } }, async (request, reply) => {
    const { cookie: value, session } = await options.auth.login((request.body as { key: string }).key);
    reply.setCookie(COOKIE, value, { path: '/', secure: true, httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400 });
    return { csrfToken: session.csrf, mode: 'readonly', mustSetPassword: options.auth.mustSetPassword };
  });
  app.get('/api/session', async request => ({ csrfToken: authenticated.get(request)!.csrf, mode: 'readonly', mustSetPassword: options.auth.mustSetPassword }));
  // The owner's first password of their own, from a session opened with the temporary one. Replacing
  // the credential ends every session, this one included, so it signs straight back in with the new
  // password and hands over a fresh cookie and CSRF token: the owner carries on where they were.
  app.post('/api/password', { schema: { body: { type: 'object', additionalProperties: false, required: ['password'], properties: { password: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX } } } } }, async (_request, reply) => {
    if (!options.setPassword || !options.auth.mustSetPassword) throw new WebError('PASSWORD_ALREADY_SET', 403);
    const { password } = _request.body as { password: string };
    if (passwordProblem(password)) throw new WebError('PASSWORD_WEAK', 400);
    await options.setPassword(password);
    const { cookie: value, session } = await options.auth.login(password);
    reply.setCookie(COOKIE, value, { path: '/', secure: true, httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400 });
    return { csrfToken: session.csrf, mode: 'readonly', mustSetPassword: false };
  });
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
  app.get('/api/capabilities', async () => {
    const snapshot = await options.source.capabilities();
    if (options.sender) snapshot.features.send = sendCapability(options.sender.mode);
    return snapshot;
  });
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
    // The type comes from a fixed allowlist of images and audio. The response may not run anything
    // even if opened directly.
    reply.type(file.type).header('content-disposition', 'inline').header('content-security-policy', "default-src 'none'; sandbox");
    if (!file.seekable) return reply.header('content-length', file.size).send(file.stream);
    // A player moves about a recording by asking for the part it wants, and will not offer to at
    // all unless the answer says parts can be asked for.
    reply.header('accept-ranges', 'bytes');
    const span = byteRange(request.headers.range, file.seekable.length);
    if (span === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${file.seekable.length}`).send();
    // Streamed, not handed over as bytes: a buffer would meet the response cap that bounds JSON,
    // and a recording is not a response to be read.
    if (!span) return reply.header('content-length', file.seekable.length).send(Readable.from([file.seekable]));
    const part = file.seekable.subarray(span.start, span.end + 1);
    return reply.code(206).header('content-range', `bytes ${span.start}-${span.end}/${file.seekable.length}`)
      .header('content-length', part.length).send(Readable.from([part]));
  });
  app.get('/api/avatars/:id', { exposeHeadRoute: false }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!tokenValid(id)) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    const photo = await options.source.avatar(id);
    // A picture out of the address book, sniffed to a JPEG or PNG before an id was ever minted.
    return reply.type(photo.type).header('content-length', photo.size).header('content-disposition', 'inline')
      .header('content-security-policy', "default-src 'none'; sandbox").send(photo.bytes);
  });
  if (options.sender && options.sender.mode !== 'off') {
    const sender = options.sender;
    // A send-specific ceiling on top of the general per-session rate: a mutation deserves a tighter bound.
    const sendWindows = new Map<string, { window: number; count: number }>();
    const SEND_PER_MIN = 10;
    const spend = (request: FastifyRequest) => {
      const session = authenticated.get(request)!;
      const now = Date.now();
      const window = sendWindows.get(session.hash);
      if (!window || now - window.window >= 60_000) sendWindows.set(session.hash, { window: now, count: 1 });
      else if (++window.count > SEND_PER_MIN) throw new WebError('RATE_LIMITED', 429);
    };
    app.post('/api/send', { schema: { body: { type: 'object', additionalProperties: false, properties: {
      chatId: { type: 'string', minLength: 43, maxLength: 43 },
      to: { type: 'string', minLength: 1, maxLength: 256 },
      text: { type: 'string', minLength: 1, maxLength: 16384 },
      uploadIds: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 43, maxLength: 43 } },
    } } } }, async request => {
      spend(request);
      const body = request.body as { chatId?: string; to?: string; text?: string; uploadIds?: string[] };
      return sender.send({
        ...(body.chatId !== undefined ? { chatId: body.chatId } : {}),
        ...(body.to !== undefined ? { to: body.to } : {}),
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.uploadIds !== undefined ? { uploadIds: body.uploadIds } : {}),
      });
    });
    if (uploadsEnabled) {
      const uploads = options.uploads!;
      // The raw stream goes straight to disk; nothing buffers the body in memory.
      app.addContentTypeParser('application/octet-stream', (_request, payload, done) => { done(null, payload); });
      app.post('/api/uploads', async request => {
        spend(request);
        const query = request.query as Record<string, unknown>;
        const name = query.name;
        // A recording says so, because only a recording should be re-encoded on the way through.
        const upload = await uploads.accept(request.body as Readable, typeof name === 'string' ? name : undefined, query.voice === '1');
        // Only an opaque id and what the server made of the name; never a path.
        return { uploadId: upload.id, bytes: upload.bytes, name: upload.name };
      });
    }
  }
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
