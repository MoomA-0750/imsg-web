import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const mode = process.argv[2] ?? 'echo';
const marker = process.argv[3];
let input = '';
const requests = [];
// Keep deliberately stuck shutdown fixtures alive even after stdin reaches EOF.
const keepAlive = setInterval(() => {}, 1_000);

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (request, result = { method: request.method }) =>
  send({ jsonrpc: '2.0', id: request.id, result });
const record = request => {
  if (marker) appendFileSync(marker, `${request.method}\n`);
  if (!['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'].includes(request.method)) {
    process.stderr.write('FORBIDDEN_METHOD_DISPATCHED\n');
    process.exit(91);
  }
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  for (;;) {
    const nl = input.indexOf('\n');
    if (nl < 0) break;
    const raw = input.slice(0, nl); input = input.slice(nl + 1);
    const request = JSON.parse(raw);
    record(request); requests.push(request);

    if (mode === 'inherited-pipe') {
      // The helper exits by itself. The client must detach inherited pipes,
      // not signal this grandchild or claim a successful shutdown.
      const helper = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 1800)'], { stdio: ['ignore', 'inherit', 'inherit'] });
      if (marker) appendFileSync(marker, `HELPER:${helper.pid}\n`);
      process.exit(0);
    }
    if (mode === 'hold' || mode === 'late-subscribe' || mode === 'ignore-shutdown' || (mode === 'reverse-two' && requests.length < 2)) continue;
    if (mode === 'reverse-two') {
      const [a, b] = requests;
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: b.id, result: 'second' })}\n` +
        `${JSON.stringify({ jsonrpc: '2.0', method: 'event.synthetic', params: { safe: true } })}\n` +
        `${JSON.stringify({ jsonrpc: '2.0', id: a.id, result: 'first' })}\n`,
      );
    } else if (mode === 'utf8-split') {
      const frame = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '雪' })}\n`);
      const snow = frame.indexOf(Buffer.from('雪'));
      process.stdout.write(frame.subarray(0, snow + 1));
      setTimeout(() => process.stdout.write(frame.subarray(snow + 1)), 5);
    } else if (mode === 'bad-json') process.stdout.write('{bad json}\n');
    else if (mode === 'partial-eof') process.stdout.write('{"jsonrpc":"2.0"', () => process.exit(0));
    else if (mode === 'eof') process.exit(0);
    else if (mode === 'oversize') process.stdout.write(`${'x'.repeat(4097)}\n`);
    else if (mode === 'stderr-flood') {
      for (let i = 0; i < 1024; i++) process.stderr.write('private-fixture-data'.repeat(32));
      reply(request, 'drained');
    } else if (mode === 'numeric-lookalike') {
      send({ jsonrpc: '2.0', id: Number(request.id), result: 'wrong' });
      setTimeout(() => reply(request, 'right'), 5);
    } else if (mode === 'duplicate') {
      reply(request, 'once');
      reply(request, 'duplicate');
    } else if (mode === 'unknown-notice') {
      send({ jsonrpc: '2.0', method: 'future.notice', params: { value: 1 } });
      reply(request, 'ok');
    } else if (mode === 'remote-error') send({ jsonrpc: '2.0', id: request.id, error: { code: -32002, message: 'PRIVATE_ERROR_SENTINEL', data: { path: 'PRIVATE_PATH_SENTINEL' } } });
    else reply(request);
  }
});
process.stdin.resume();

process.stdin.on('end', () => {
  if (mode !== 'late-subscribe' && mode !== 'ignore-shutdown') {
    clearInterval(keepAlive);
    process.exit(0);
  }
});

if (mode === 'ignore-shutdown') {
  process.on('SIGTERM', () => {});
  if (marker) appendFileSync(marker, `PID:${process.pid}\n`);
}

if (mode === 'late-subscribe') {
  setTimeout(() => {
    if (!requests[0]) return;
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: requests[0].id, result: 'too-late' })}\n`, () => {
      if (marker) appendFileSync(marker, 'LATE_RESPONSE_SENT\n');
      clearInterval(keepAlive);
      process.exit(0);
    });
  }, 80);
}
