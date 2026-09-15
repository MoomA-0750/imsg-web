// HTTPS browser fixture. Synthetic data only; never imports or launches imsg.
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../dist/server/http.js';
import { Auth, hashKey } from '../dist/server/auth.js';
import { WebError } from '../dist/server/web-error.js';
import { Readable } from 'node:stream';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const directory = await mkdtemp(join(tmpdir(), 'iw-browser-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const app = await createApp({ origin: 'https://127.0.0.1:19443', auth: new Auth(hashKey('A'.repeat(43))), webDir: new URL('../dist/web', import.meta.url).pathname, source: {
  async chats(limit) { return { epoch: 'epoch-a', limit, chats: [
    { id: 'C'.repeat(43), name: '合成テスト会話 Alpha', service: 'iMessage', isGroup: null, unreadCount: null, lastMessageAt: null, trimmed: false },
    { id: 'D'.repeat(43), name: '合成テスト会話 Beta', service: 'SMS', isGroup: false, unreadCount: 2, lastMessageAt: '2026-09-08T00:00:00Z', trimmed: false },
    { id: 'G'.repeat(43), name: '合成グループ Gamma', service: 'iMessage', isGroup: true, unreadCount: 0, lastMessageAt: null, trimmed: false },
  ] }; },
  async history(id, limit) { return { epoch: 'epoch-a', limit, messages: id.startsWith('G') ? [
    { id: 'H'.repeat(43), text: '', isFromMe: false, sender: '合成送信者 Delta', attachments: [
      { id: 'P'.repeat(43), kind: 'image', sticker: false, preview: false }, { id: 'Q'.repeat(43), kind: 'image', sticker: false, preview: false },
      { id: null, kind: 'image', sticker: false, preview: false }, { id: null, kind: 'video', sticker: false, preview: false },
      { id: 'T'.repeat(43), kind: 'image', sticker: false, preview: true },
    ], link: null, createdAt: null, trimmed: false },
    { id: 'L'.repeat(43), text: '', isFromMe: false, sender: '合成送信者 Delta', attachments: [], link: { url: 'https://example.invalid/synthetic-article', title: '合成リンクのタイトル', summary: '合成リンクの概要', siteName: '合成サイト', image: { id: 'P'.repeat(43), kind: 'image', sticker: false, preview: false } }, createdAt: null, trimmed: false },
    { id: 'J'.repeat(43), text: '危険なリンクの合成本文', isFromMe: false, sender: '合成送信者 Delta', attachments: [], link: { url: 'javascript:alert(1)', title: '開いてはいけない合成リンク', summary: '', siteName: '', image: null }, createdAt: null, trimmed: false },
  ] : [
    { id: 'E'.repeat(43), text: id.startsWith('C') ? 'Alpha の合成本文 <img src="https://invalid.test/leak">' : 'Beta の合成本文', isFromMe: false, sender: '合成送信者 Hidden', attachments: [], link: null, createdAt: null, trimmed: false },
    { id: 'F'.repeat(43), text: '送信済みの合成メッセージです。', isFromMe: true, sender: null, attachments: [], link: null, createdAt: '2026-09-08T00:01:00Z', trimmed: false },
  ] }; },
  async capabilities() { return { epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' }, send: { state: 'unknown', reasonCode: 'NOT_IMPLEMENTED' } } }; },
  async attachment(id) {
    // P (an image) and T (a thumbnail) are a real 1×1 PNG; Q claims to be HEIC but is not decodable.
    const body = id === 'P'.repeat(43) || id === 'T'.repeat(43) ? PNG : id === 'Q'.repeat(43) ? Buffer.from('synthetic-not-an-image') : undefined;
    if (!body) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    return { type: id.startsWith('Q') ? 'image/heic' : 'image/png', size: body.length, stream: Readable.from([body]) };
  },
  async close() {},
}, uploads: {
  // Synthetic upload sink: counts the streamed bytes, writes nothing, returns an opaque id.
  maxBytes: 100 * 1024 * 1024,
  async accept(body, name) {
    let bytes = 0;
    for await (const chunk of body) bytes += chunk.length;
    return { id: 'U'.repeat(43), dir: '/synthetic', path: `/synthetic/${name ?? 'attachment'}`, name: name ?? 'attachment', bytes, created: 0 };
  },
}, sender: {
  // Synthetic in-process sender: never touches imsg or Messages. Outcome chosen by markers in the text.
  mode: 'live',
  async send({ text }) {
    if (String(text ?? '').includes('UNKNOWN')) return { state: 'unknown' };
    if (String(text ?? '').includes('FAIL')) return { state: 'failed', code: 'synthetic' };
    return { state: 'sent' };
  },
} });
await app.ready();
const server = createServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, (request, response) => app.routing(request, response));
server.maxConnections = 64;
await new Promise(resolve => server.listen(19443, '127.0.0.1', resolve));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.close(); await rm(directory, { recursive: true, force: true }); }
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
