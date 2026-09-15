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
import { crc32, deflateSync } from 'node:zlib';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// A PNG with real dimensions, so a message grows by a visible amount when its image loads.
// One flat colour, so the pixels compress to nothing however large the picture is.
function solidPNG(width, height) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8 bits per channel, truecolour
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const TALL_PNG = solidPNG(240, 180);
const FACE_PNG = solidPNG(64, 64);
// A conversation long enough to scroll. #1 is the newest and sits last, so asking for a
// larger limit adds older messages above and leaves the bottom of the list unchanged.
// Four messages to a day, counting back from today, so the list carries several day breaks and
// the newest of them is labelled 今日 whenever the suite runs.
// Morning, morning, afternoon, afternoon: two close pairs with a long quiet in between, so each
// day carries a day break and a resumed-after-a-pause break.
const SLOTS = [[15, 0], [14, 40], [9, 20], [9, 5]];
const clock = (back, hour, minute) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - back);
  return date.toISOString();
};
const today = (hour, minute) => clock(0, hour, minute);
const yesterday = (hour, minute) => clock(1, hour, minute);
const dayOf = n => {
  const date = new Date();
  const [hour, minute] = SLOTS[(n - 1) % 4];
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - Math.floor((n - 1) / 4));
  return date.toISOString();
};
const longChat = (limit, withImage = false) => Array.from({ length: limit }, (_, index) => {
  const n = limit - index;
  // Every third one is the owner's, so the list carries both runs and the breaks between them.
  const mine = n % 3 === 0;
  return { id: `S${String(n).padStart(42, '0')}`, text: `合成メッセージ #${n}`, isFromMe: mine, sender: mine ? null : '合成送信者 Sigma',
    // An image carries no height until it loads, so a list of them settles well after it is drawn.
    attachments: withImage ? [{ id: 'W'.repeat(43), kind: 'image', sticker: false, preview: false }] : [],
    link: null, replyTo: null, reactions: [], createdAt: dayOf(n), trimmed: false, avatarId: null };
});
const directory = await mkdtemp(join(tmpdir(), 'iw-browser-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const app = await createApp({ origin: 'https://127.0.0.1:19443', auth: new Auth(hashKey('A'.repeat(43))), webDir: new URL('../dist/web', import.meta.url).pathname, source: {
  async chats(limit) { return { epoch: 'epoch-a', limit, chats: [
    { id: 'C'.repeat(43), name: '合成テスト会話 Alpha', service: 'iMessage', isGroup: null, unreadCount: null, lastMessageAt: null, trimmed: false, preview: { text: '送信済みの合成メッセージです。', trimmed: false, fromMe: true }, avatarId: 'A'.repeat(43) },
    { id: 'D'.repeat(43), name: '合成テスト会話 Beta', service: 'SMS', isGroup: false, unreadCount: 2, lastMessageAt: '2026-09-08T00:00:00Z', trimmed: false, preview: { text: '一覧に出る合成プレビュー', trimmed: true, fromMe: false }, avatarId: null },
    { id: 'G'.repeat(43), name: '合成グループ Gamma', service: 'iMessage', isGroup: true, unreadCount: 0, lastMessageAt: null, trimmed: false, preview: { text: '画像', trimmed: false, fromMe: false }, avatarId: null },
    { id: 'S'.repeat(43), name: '合成長尺 Sigma', service: 'iMessage', isGroup: false, unreadCount: 0, lastMessageAt: null, trimmed: false, preview: null, avatarId: null },
    { id: 'V'.repeat(43), name: '合成画像列 Vega', service: 'iMessage', isGroup: false, unreadCount: 0, lastMessageAt: null, trimmed: false, preview: null, avatarId: null },
  ] }; },
  async history(id, limit) { return { epoch: 'epoch-a', limit, messages: id.startsWith('V') ? longChat(limit, true) : id.startsWith('S') ? longChat(limit) : id.startsWith('G') ? [
    { id: 'H'.repeat(43), text: '', isFromMe: false, sender: '合成送信者 Delta', avatarId: 'A'.repeat(43), attachments: [
      { id: 'P'.repeat(43), kind: 'image', sticker: false, preview: false }, { id: 'Q'.repeat(43), kind: 'image', sticker: false, preview: false },
      { id: null, kind: 'image', sticker: false, preview: false }, { id: null, kind: 'video', sticker: false, preview: false },
      { id: 'T'.repeat(43), kind: 'image', sticker: false, preview: true },
    ], link: null, replyTo: null, reactions: [], createdAt: yesterday(9, 0), trimmed: false },
    { id: 'L'.repeat(43), text: '', isFromMe: false, sender: '合成送信者 Delta', avatarId: 'A'.repeat(43), attachments: [], link: { url: 'https://example.invalid/synthetic-article', title: '合成リンクのタイトル', summary: '合成リンクの概要', siteName: '合成サイト', image: { id: 'P'.repeat(43), kind: 'image', sticker: false, preview: false } }, replyTo: null, reactions: [], createdAt: yesterday(9, 20), trimmed: false },
    { id: 'J'.repeat(43), text: '危険なリンクの合成本文', isFromMe: false, sender: '合成送信者 Delta', avatarId: 'A'.repeat(43), attachments: [], link: { url: 'javascript:alert(1)', title: '開いてはいけない合成リンク', summary: '', siteName: '', image: null }, replyTo: null, reactions: [], createdAt: today(9, 0), trimmed: false },
    { id: 'R'.repeat(43), text: '返信の合成本文', isFromMe: false, sender: '合成送信者 Epsilon', avatarId: null, attachments: [], link: null,
      replyTo: { sender: '合成送信者 Epsilon', text: '元になった合成メッセージ', trimmed: true },
      reactions: [
        { emoji: '❤️', kind: 'love', senders: ['合成送信者 Alpha', '合成送信者 Beta'], fromMe: true, count: 3 },
        { emoji: '👍', kind: 'like', senders: ['合成送信者 Gamma'], fromMe: false, count: 1 },
      ], createdAt: today(9, 10), trimmed: false },
  ] : [
    { id: 'E'.repeat(43), text: id.startsWith('C') ? 'Alpha の合成本文 <img src="https://invalid.test/leak">' : 'Beta の合成本文', isFromMe: false, sender: '合成送信者 Hidden', avatarId: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false },
    { id: 'F'.repeat(43), text: '送信済みの合成メッセージです。', isFromMe: true, sender: null, avatarId: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: '2026-09-08T00:01:00Z', trimmed: false },
  ] }; },
  async capabilities() { return { epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' }, send: { state: 'unknown', reasonCode: 'NOT_IMPLEMENTED' } } }; },
  async attachment(id) {
    // P is a real 1×1 PNG; T (a thumbnail) and W are 240×180, so a picture has something to cover;
    // Q claims to be HEIC but is not decodable.
    const body = id === 'P'.repeat(43) ? PNG : id === 'T'.repeat(43) || id === 'W'.repeat(43) ? TALL_PNG
      : id === 'Q'.repeat(43) ? Buffer.from('synthetic-not-an-image') : undefined;
    if (!body) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    return { type: id.startsWith('Q') ? 'image/heic' : 'image/png', size: body.length, stream: Readable.from([body]) };
  },
  async avatar(id) {
    if (id !== 'A'.repeat(43)) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    return { type: 'image/png', size: FACE_PNG.length, bytes: FACE_PNG };
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
  async send({ text, uploadIds }) {
    const total = uploadIds?.length ?? 0;
    if (String(text ?? '').includes('UNKNOWN')) return total > 0 ? { state: 'unknown', sent: 0, total } : { state: 'unknown' };
    if (String(text ?? '').includes('FAIL')) return total > 0 ? { state: 'failed', sent: 0, total } : { state: 'failed' };
    return total > 0 ? { state: 'sent', sent: total, total } : { state: 'sent' };
  },
} });
await app.ready();
const server = createServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, (request, response) => app.routing(request, response));
server.maxConnections = 64;
await new Promise(resolve => server.listen(19443, '127.0.0.1', resolve));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.close(); await rm(directory, { recursive: true, force: true }); }
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
