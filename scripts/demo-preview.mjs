// Synthetic-only HTTP preview. Never import the production server, auth or RPC.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const epoch = 'demo-only';
const names = ['カフェの待ち合わせ（架空）', '週末のお出かけ（架空）', '読書メモ（架空）', '空の会話（架空）'];
const texts = ['明日は駅前のカフェで待ち合わせにしませんか？ ☕', 'いいですね。14時ごろに着く予定です。',
  '了解です！\n窓側の席が空いていたら、先に座っています。', 'ありがとう。また明日！',
  'これは操作確認用の架空メッセージです。実際のメッセージの送信・既読変更は行いません。'];
const chatId = i => String(i + 1).padStart(43, 'D');
const date = i => new Date(Date.UTC(2026, 8, 12, 4, i)).toISOString();
const chats = Array.from({ length: 60 }, (_, i) => ({ id: chatId(i), name: names[i] ?? `サンプル会話 ${i + 1}（架空）`,
  service: i % 3 ? 'iMessage' : 'SMS', isGroup: i === 1, unreadCount: i === 0 ? 2 : 0,
  lastMessageAt: date(i), trimmed: false }));
const bannerCss = 'body{padding-top:88px!important}.app,.center{height:calc(100dvh - 88px)!important;min-height:0!important}.demo-banner{position:fixed;inset:0 0 auto;z-index:9999;height:88px;box-sizing:border-box;padding:8px 12px;background:#fff2c9;color:#513d00;font:14px/1.5 system-ui;border-bottom:1px solid #c9af56}.demo-banner strong{display:block}';

export async function createDemoServer() {
  const root = new URL('../dist/web/', import.meta.url);
  const files = new Map();
  for (const name of await readdir(new URL('assets/', root))) {
    if (!/^[A-Za-z0-9_.-]+\.(js|css)$/.test(name)) continue;
    files.set(`/assets/${name}`, [await readFile(new URL(`assets/${name}`, root)), name.endsWith('.css') ? 'text/css' : 'text/javascript']);
  }
  const html = (await readFile(new URL('index.html', root), 'utf8'))
    .replace('</head>', '<link rel="stylesheet" href="/demo-preview.css"></head>')
    .replace('<body>', '<body><aside class="demo-banner"><strong>操作プレビュー · 架空データのみ／実送信なし</strong>ログインキー: demo（本物の所有者キーは入力しないでください）</aside>');
  files.set('/', [html, 'text/html']); files.set('/demo-preview.css', [bannerCss, 'text/css']);
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
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
      if (req.method !== 'GET') return send(405, { error: 'DEMO_READONLY' });
      if (url.pathname === '/api/capabilities') return send(200, { epoch, mode: 'readonly', features: {
        chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' },
        read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' }, typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
      } });
      const limit = Number(url.searchParams.get('limit') ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return send(400, { error: 'DEMO_LIMIT' });
      if (url.pathname === '/api/chats') return send(200, { epoch, limit, chats: chats.slice(0, limit) });
      const match = /^\/api\/chats\/([A-Za-z0-9_-]{43})\/messages$/.exec(url.pathname);
      if (match && chats.some(c => c.id === match[1])) return send(200, { epoch, limit,
        messages: match[1] === chatId(3) ? [] : Array.from({ length: Math.min(60, limit) }, (_, i) => ({
          id: String(i).padStart(43, 'M'), text: texts[i % texts.length], isFromMe: i % 2 === 1, createdAt: date(i), trimmed: false,
        })) });
      return send(404, { error: 'DEMO_NOT_FOUND' });
    } catch { if (!res.headersSent) send(400, { error: 'DEMO_INPUT' }); else res.destroy(); }
  });
  server.maxConnections = 32;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.argv[2], port = Number(process.argv[3] ?? 18787);
  const octets = host?.split('.').map(Number);
  if (!octets || octets.length !== 4 || octets[0] !== 100 || octets[1] < 64 || octets[1] > 127
    || !octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DEMO_TAILSCALE_ADDRESS_REQUIRED');
  const server = await createDemoServer();
  server.on('error', () => { console.error('DEMO_LISTEN_FAILED'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Synthetic preview: http://${host}:${port} — key: demo`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
