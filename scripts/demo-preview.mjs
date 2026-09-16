// Synthetic-only HTTP preview. Never import the production server, auth or RPC.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const epoch = 'demo-only';
const names = ['カフェの待ち合わせ（架空）', '週末のお出かけ（架空）', '読書メモ（架空）', '空の会話（架空）'];
const chatId = i => String(i + 1).padStart(43, 'D');
const id = (letter) => letter.repeat(43);
/** Yesterday and today, so the conversation carries a day break wherever it is opened. */
const at = (back, hour, minute) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - back);
  return date.toISOString();
};

/**
 * Pictures and a sound, made here rather than kept as files: a preview of a messaging app should
 * contain nothing anybody ever sent. The gradient is not a photograph and is not pretending to be.
 */
function png(width, height, pixel) {
  const crc32 = (buffer) => { let c = ~0; for (const byte of buffer) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, body) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x / width, y / height);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));
const PHOTO = png(560, 380, (x, y) => mix(mix([255, 214, 165], [126, 188, 236], x), [63, 94, 148], y * 0.75));
const FACE_A = png(96, 96, (x, y) => mix([244, 162, 97], [231, 111, 81], (x + y) / 2));
const FACE_B = png(96, 96, (x, y) => mix([129, 178, 154], [61, 90, 128], (x + y) / 2));
function wav(seconds, rate = 8000) {
  const frames = Math.round(seconds * rate), body = Buffer.alloc(frames * 2);
  for (let n = 0; n < frames; n++) body.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 320 * n / rate) * Math.min(1, (frames - n) / rate)), n * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + body.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(body.length, 40);
  return Buffer.concat([head, body]);
}
const VOICE = wav(7);
const media = new Map([[id('P'), ['image/png', PHOTO]], [id('V'), ['audio/wav', VOICE]]]);
const faces = new Map([[id('A'), FACE_A], [id('B'), FACE_B]]);

const preview = (text, fromMe = false) => ({ text, trimmed: false, fromMe });
const chats = [
  { id: chatId(0), name: names[0], service: 'iMessage', isGroup: false, unreadCount: 2, lastMessageAt: at(0, 12, 10),
    trimmed: false, preview: preview('窓側の席、取れました'), faces: [id('A')] },
  { id: chatId(1), name: names[1], service: 'iMessage', isGroup: true, unreadCount: 0, lastMessageAt: at(0, 11, 40),
    trimmed: false, preview: preview('写真ありがとう！'), faces: [id('A'), null, id('B')] },
  { id: chatId(2), name: names[2], service: 'SMS', isGroup: false, unreadCount: 0, lastMessageAt: at(1, 21, 5),
    trimmed: false, preview: preview('読み終わったら貸してください', true), faces: [] },
  { id: chatId(3), name: names[3], service: 'iMessage', isGroup: false, unreadCount: 0, lastMessageAt: null,
    trimmed: false, preview: null, faces: [] },
  ...Array.from({ length: 56 }, (_, i) => ({ id: chatId(i + 4), name: `サンプル会話 ${i + 1}（架空）`,
    service: i % 3 ? 'iMessage' : 'SMS', isGroup: false, unreadCount: 0, lastMessageAt: at(2 + Math.floor(i / 4), 9, i % 60),
    trimmed: false, preview: preview('操作確認用の架空メッセージです'), faces: [] })),
];

const message = (letter, text, isFromMe, when, extra = {}) => ({ id: id(letter), text, isFromMe,
  sender: extra.sender ?? null, avatarId: extra.avatarId ?? null, attachments: extra.attachments ?? [],
  link: extra.link ?? null, replyTo: extra.replyTo ?? null, reactions: extra.reactions ?? [],
  createdAt: when, trimmed: false });
const picture = { id: id('P'), kind: 'image', sticker: false, preview: false };
const recording = { id: id('V'), kind: 'audio', sticker: false, preview: false };
const conversations = {
  [chatId(0)]: [
    message('E', '明日は駅前のカフェで待ち合わせにしませんか？ ☕', false, at(1, 20, 12), { avatarId: id('A') }),
    message('F', 'いいですね。14時ごろに着く予定です。', true, at(1, 20, 31)),
    message('G', '', false, at(0, 12, 2), { attachments: [picture], avatarId: id('A') }),
    message('H', '窓側の席、取れました', false, at(0, 12, 10), { avatarId: id('A'),
      reactions: [{ emoji: '❤️', kind: 'love', senders: [], fromMe: true, count: 1 }] }),
  ],
  [chatId(1)]: [
    message('I', '土曜、どこか行きませんか', false, at(1, 19, 0), { sender: '架空の友人 A', avatarId: id('A') }),
    message('J', '', false, at(0, 11, 20), { sender: '架空の友人 B', avatarId: id('B'), attachments: [recording] }),
    message('K', '写真ありがとう！', true, at(0, 11, 40), {
      replyTo: { sender: '架空の友人 A', text: '土曜、どこか行きませんか', trimmed: false, messageId: id('I') },
      reactions: [{ emoji: '👍', kind: 'like', senders: ['架空の友人 A'], fromMe: false, count: 2 }] }),
  ],
  [chatId(2)]: [
    message('L', '読み終わったら貸してください', true, at(1, 21, 5)),
  ],
  [chatId(3)]: [],
};
const bannerCss = 'body{padding-top:88px!important}.app,.center{height:calc(100dvh - 88px)!important;min-height:0!important}.demo-banner{position:fixed;inset:0 0 auto;z-index:9999;height:88px;box-sizing:border-box;padding:8px 12px;background:#fff2c9;color:#513d00;font:14px/1.5 system-ui;border-bottom:1px solid #c9af56}.demo-banner strong{display:block}';

export async function createDemoServer({ banner = true } = {}) {
  const root = new URL('../dist/web/', import.meta.url);
  const files = new Map();
  for (const name of await readdir(new URL('assets/', root))) {
    if (!/^[A-Za-z0-9_.-]+\.(js|css)$/.test(name)) continue;
    files.set(`/assets/${name}`, [await readFile(new URL(`assets/${name}`, root)), name.endsWith('.css') ? 'text/css' : 'text/javascript']);
  }
  const html = banner
    ? (await readFile(new URL('index.html', root), 'utf8'))
      .replace('</head>', '<link rel="stylesheet" href="/demo-preview.css"></head>')
      .replace('<body>', '<body><aside class="demo-banner"><strong>操作プレビュー · 架空データのみ／実送信なし</strong>ログインキー: demo（本物の所有者キーは入力しないでください）</aside>')
    : await readFile(new URL('index.html', root), 'utf8');
  files.set('/', [html, 'text/html']); files.set('/demo-preview.css', [bannerCss, 'text/css']);
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        // The same policy the real server sends, so the preview shows what the app is actually
        // allowed to do — a missing media-src here made voice messages silently unplayable.
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      const address = server.address(), host = `${address.address}:${address.port}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(403, { error: 'DEMO_ORIGIN' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && files.has(url.pathname)) { const [body, type] = files.get(url.pathname); return send(200, body, type); }
      const session = { csrfToken: 'demo-only', mode: 'readonly' };
      const loggedIn = /(?:^|;\s*)imsg_demo=1(?:;|$)/.test(req.headers.cookie ?? '');
      if (url.pathname === '/api/session') {
        if (req.method === 'GET') return send(loggedIn ? 200 : 401, loggedIn ? session : { error: 'DEMO_LOGIN' });
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) { body += chunk.toString(); if (body.length > 1024) return send(413, { error: 'DEMO_INPUT' }); }
          if (JSON.parse(body).key !== 'demo') return send(401, { error: 'DEMO_KEY' });
          res.setHeader('Set-Cookie', 'imsg_demo=1; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400');
          return send(200, session);
        }
        if (req.method === 'DELETE' && loggedIn && req.headers['x-csrf-token'] === 'demo-only') {
          res.setHeader('Set-Cookie', 'imsg_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return send(200, { ok: true });
        }
      }
      if (!loggedIn) return send(401, { error: 'DEMO_LOGIN' });
      // The composer is offered in dry-run, so it can be tried; these two answer it and dispatch
      // nothing. There is no Messages here to dispatch to.
      if (req.method === 'POST' && url.pathname === '/api/uploads') {
        let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) return send(413, { error: 'DEMO_INPUT' }); }
        return send(200, { uploadId: id('U'), bytes, name: url.searchParams.get('name') ?? 'attachment' });
      }
      if (req.method === 'POST' && url.pathname === '/api/send') {
        for await (const chunk of req) { void chunk; }
        return send(200, { state: 'dry_run' });
      }
      if (req.method !== 'GET') return send(405, { error: 'DEMO_READONLY' });
      if (url.pathname === '/api/capabilities') return send(200, { epoch, mode: 'readonly', features: {
        chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' },
        read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' }, typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
        send: { state: 'available', reasonCode: 'SEND_DRY_RUN' },
      } });
      const limit = Number(url.searchParams.get('limit') ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return send(400, { error: 'DEMO_LIMIT' });
      if (url.pathname === '/api/chats') return send(200, { epoch, limit, chats: chats.slice(0, limit) });
      const match = /^\/api\/chats\/([A-Za-z0-9_-]{43})\/messages$/.exec(url.pathname);
      if (match && chats.some(c => c.id === match[1])) return send(200, { epoch, limit,
        messages: (conversations[match[1]] ?? [message('M', '操作確認用の架空メッセージです。実際の送信や既読変更は行いません。', false, at(2, 9, 0))]).slice(-limit) });
      const asset = /^\/api\/(attachments|avatars)\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
      if (asset && asset[1] === 'attachments' && media.has(asset[2])) {
        const [type, body] = media.get(asset[2]);
        return send(200, body, type);
      }
      if (asset && asset[1] === 'avatars' && faces.has(asset[2])) return send(200, faces.get(asset[2]), 'image/png');
      return send(404, { error: 'DEMO_NOT_FOUND' });
    } catch { if (!res.headersSent) send(400, { error: 'DEMO_INPUT' }); else res.destroy(); }
  });
  server.maxConnections = 32;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.argv[2] ?? '127.0.0.1', port = Number(process.argv[3] ?? 18787);
  // Loopback by default. A tailnet address is allowed so the preview can be opened from a phone;
  // nothing else is, because this serves a login screen and should not be on a shared network.
  const octets = host.split('.').map(Number);
  const tailnet = octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
    && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if ((!tailnet && !loopback) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DEMO_LOOPBACK_OR_TAILSCALE_ADDRESS_REQUIRED');
  const server = await createDemoServer();
  server.on('error', () => { console.error('DEMO_LISTEN_FAILED'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Synthetic preview: http://${host}:${port} — key: demo`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
