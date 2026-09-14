// Synthetic stand-in for `imsg rpc` on the send path. Never touches real data or Messages.
// It replies based on markers in the request text, so tests can drive each outcome.
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (!request || request.method !== 'send.tracked') return;
  const text = String(request.params?.text ?? '');
  const reply = (body) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...body }) + '\n');
  if (text.includes('HANG')) return;                 // never answer: the client should time out (ambiguous)
  if (text.includes('EXIT')) { process.exit(0); }    // close without answering (ambiguous)
  if (text.includes('DUP')) return reply({ error: { code: -32602, message: 'attempt_id already identifies a message; choose a new UUID' } });
  if (text.includes('ERR')) return reply({ error: { code: -32000, message: 'synthetic send failure' } });
  if (text.includes('NOTICE')) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: {} }) + '\n');
  reply({ result: { ok: true, transport: 'applescript', attempt_id: request.params?.attempt_id } });
});
