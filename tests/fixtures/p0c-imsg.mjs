#!/usr/bin/env node
// Synthetic subprocess only. Its sibling config and audit contain no real Messages data.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const dir = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
const record = value => appendFileSync(join(dir, 'audit.jsonl'), `${JSON.stringify({ pid: process.pid, ...value })}\n`);
const args = process.argv.slice(2);
record({ kind: 'spawn', args });
const allowed = ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'];
const status = { version: config.version, protocol_version: 1, database: { ready: true, path: join(dir, 'chat.db') }, bridge: { ready: config.sip === 'disabled' }, contacts: { available: false }, methods: [...allowed, 'send', 'read', 'typing', 'message.edit'] };
if (JSON.stringify(args) === JSON.stringify(['status', '--json'])) {
  process.stdout.write(JSON.stringify({ version: config.version, sip: config.sip, read_receipts: true, typing_indicators: true }));
} else if (args[0] === 'rpc' && (args.length === 1 || (args.length === 2 && args[1] === '--contacts-from-address-book'))) {
  const pending = new Map();
  let ended = false;
  const finish = (request, late = false) => {
    let result;
    if (request.method === 'status') result = status;
    if (request.method === 'chats.list') result = { chats: Array.from({ length: Math.min(50, request.params.limit) }, (_, i) => ({ id: i + 1, guid: `synthetic-chat-${i + 1}`, name: `Synthetic ${i + 1}`, service: 'iMessage' })) };
    if (request.method === 'messages.history') result = { messages: [{ id: 1, chat_id: request.params.chat_id, guid: 'synthetic-message', text: 'P0C_SYNTHETIC_BODY', is_from_me: false }] };
    if (request.method === 'watch.subscribe') result = { subscription: 1 };
    if (request.method === 'watch.unsubscribe') result = { ok: true };
    record({ kind: 'response', method: request.method, late });
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  };
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    const request = JSON.parse(line);
    record({ kind: 'request', method: request.method, params: request.params });
    // Unexpected requests are recorded before failing, so the test detects attempted writes.
    if (!allowed.includes(request.method)) { process.exitCode = 81; input.close(); return; }
    if (request.method === 'messages.history' && existsSync(join(dir, 'hold'))) {
      const timer = setInterval(() => {
        if (existsSync(join(dir, 'hold'))) return;
        clearInterval(timer); pending.delete(request); finish(request);
        if (ended && pending.size === 0) process.exitCode = 0;
      }, 5);
      pending.set(request, timer);
    } else finish(request);
  });
  input.on('close', () => { ended = true; });
  if (config.lateOnTerm) process.on('SIGTERM', () => {
    setTimeout(() => {
      for (const [request, timer] of pending) { clearInterval(timer); finish(request, true); }
      pending.clear();
      process.stdout.write('', () => process.exit(0));
    }, 40);
  });
} else process.exitCode = 80;
