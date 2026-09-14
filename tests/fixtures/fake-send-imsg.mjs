// Synthetic stand-in for `imsg rpc` on the send path. Never touches real data or Messages.
// It replies based on markers in the request text, so tests can drive each outcome.
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (!request || request.method !== 'send') return;
  const text = String(request.params?.text ?? '');
  const reply = (body) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...body }) + '\n');
  if (text.includes('HANG')) return;              // never answer: the client should time out (ambiguous)
  if (text.includes('EXIT')) { process.exit(0); } // close without answering (ambiguous)
  // imsg reports whether the send left the Mac. not_started / retry_safe → safe to retry (failed).
  if (text.includes('NOTSTARTED')) return reply({ error: { code: -32603, message: 'Delivery failed before dispatch', data: { transport: 'applescript', retry_safe: true, disposition: 'not_started', operation: 'send' } } });
  if (text.includes('BADPARAM')) return reply({ error: { code: -32602, message: 'Invalid params', data: 'bad recipient' } });
  if (text.includes('MAYBESENT')) return reply({ error: { code: -32603, message: 'Delivery failed after dispatch', data: { disposition: 'dispatched', retry_safe: false } } });
  if (text.includes('NOTICE')) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: {} }) + '\n');
  reply({ result: { ok: true, transport: 'applescript' } });
});
