// Synthetic child only; never reads Messages or launches another process.
import { createInterface } from 'node:readline';
const [path, mode] = process.argv.slice(2);
if (mode === 'stubborn') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const { id, method, params } = JSON.parse(line);
  let result;
  if (method === 'status') result = {
    version: '0.15.1', protocol_version: 1, database: { ready: true, path },
    bridge: { ready: false }, contacts: { available: false },
    methods: ['status', 'chats.list', 'messages.history'],
  };
  else if (method === 'chats.list') result = { chats: [{ id: 1, guid: 'synthetic-chat', name: 'Synthetic', service: 'iMessage' }] };
  else if (method === 'messages.history') {
    if (mode === 'hold-history') return;
    if (mode === 'stubborn') { process.stderr.write('synthetic-history-entered\n'); return; }
    result = { messages: [{ id: 2, chat_id: params.chat_id, guid: 'synthetic-message', text: 'Synthetic', is_from_me: false }] };
  } else { process.exitCode = 1; lines.close(); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
});
