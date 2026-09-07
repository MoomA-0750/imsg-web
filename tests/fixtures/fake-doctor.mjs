#!/usr/bin/env node
// Synthetic protocol shapes only. Never connects to Messages.
import { appendFileSync } from 'node:fs';
const mode = process.env.DOCTOR_TEST_MODE ?? 'normal';
const secret = 'PRIVATE_DOCTOR_SENTINEL';
const rpc = {
  version: '0.15.1', protocol_version: 1,
  database: { ready: mode !== 'db-denied', path: secret }, bridge: { ready: false, error: secret },
  contacts: { available: true }, methods: ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'],
};
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
if (process.argv[2] === 'status') {
  process.stderr.write(secret);
  write({ version: '0.15.1', sip: 'enabled', message: secret, read_receipts: false, typing_indicators: false });
} else if (process.argv[2] === 'rpc') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    while (input.includes('\n')) {
      const end = input.indexOf('\n');
      const request = JSON.parse(input.slice(0, end)); input = input.slice(end + 1);
      if (process.env.DOCTOR_TEST_MARKER) appendFileSync(process.env.DOCTOR_TEST_MARKER, request.method + '\n');
      let result;
      switch (request.method) {
        case 'status': result = rpc; break;
        case 'chats.list': result = { chats: mode === 'empty' ? [] : [{ id: 1, name: secret, guid: secret, service: 'iMessage', account_login: secret }] }; break;
        case 'messages.history': result = { messages: [{ id: 2, chat_id: 1, guid: secret, text: secret, is_from_me: false, attachments: [{ original_path: secret }], reply_context: { text: secret } }] }; break;
        case 'watch.subscribe': result = { subscription: 1 }; break;
        case 'watch.unsubscribe': result = { ok: true }; break;
        default: process.exit(91);
      }
      write({ jsonrpc: '2.0', id: request.id, result });
    }
  });
} else process.exit(92);
