// HTTPS browser fixture. Synthetic data only; never imports or launches imsg.
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../dist/server/http.js';
import { Auth, hashKey } from '../dist/server/auth.js';
const directory = await mkdtemp(join(tmpdir(), 'iw-browser-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const app = await createApp({ origin: 'https://127.0.0.1:19443', auth: new Auth(hashKey('A'.repeat(43))), webDir: new URL('../dist/web', import.meta.url).pathname, source: {
  async chats(limit) { return { epoch: 'epoch-a', limit, chats: [
    { id: 'C'.repeat(43), name: '合成テスト会話 Alpha', service: 'iMessage', isGroup: null, unreadCount: null, lastMessageAt: null, trimmed: false },
    { id: 'D'.repeat(43), name: '合成テスト会話 Beta', service: 'SMS', isGroup: false, unreadCount: 2, lastMessageAt: '2026-09-08T00:00:00Z', trimmed: false },
    { id: 'G'.repeat(43), name: '合成グループ Gamma', service: 'iMessage', isGroup: true, unreadCount: 0, lastMessageAt: null, trimmed: false },
  ] }; },
  async history(id, limit) { return { epoch: 'epoch-a', limit, messages: id.startsWith('G') ? [
    { id: 'H'.repeat(43), text: '', isFromMe: false, sender: '合成送信者 Delta', attachments: 2, createdAt: null, trimmed: false },
  ] : [
    { id: 'E'.repeat(43), text: id.startsWith('C') ? 'Alpha の合成本文 <img src="https://invalid.test/leak">' : 'Beta の合成本文', isFromMe: false, sender: '合成送信者 Hidden', attachments: 0, createdAt: null, trimmed: false },
    { id: 'F'.repeat(43), text: '送信済みの合成メッセージです。', isFromMe: true, sender: null, attachments: 0, createdAt: '2026-09-08T00:01:00Z', trimmed: false },
  ] }; },
  async capabilities() { return { epoch: 'epoch-a', mode: 'readonly', features: { chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' }, send: { state: 'unknown', reasonCode: 'NOT_IMPLEMENTED' } } }; },
  async close() {},
} });
await app.ready();
const server = createServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, (request, response) => app.routing(request, response));
server.maxConnections = 64;
await new Promise(resolve => server.listen(19443, '127.0.0.1', resolve));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.close(); await rm(directory, { recursive: true, force: true }); }
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
