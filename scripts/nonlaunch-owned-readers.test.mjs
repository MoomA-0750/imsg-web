import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createOwnedReaderGate } from './nonlaunch-owned-readers.mjs';

function child(mode) {
  const c = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), signals: [], unreffed: false });
  let ended = false;
  const end = () => { if (!ended) { ended = true; c.emit('close', 0, null); } };
  c.kill = signal => { c.signals.push(signal); if (mode === 'signal-zero') queueMicrotask(end); return true; };
  c.unref = () => { c.unreffed = true; };
  if (mode === 'normal') c.stdin.on('finish', end);
  return c;
}
const make = () => createOwnedReaderGate({ graceMs: 5, killWaitMs: 5 });

test('constructor throw after registration still closes its exact orphan handle', async () => {
  const gate = make(), c = child('normal');
  assert.throws(() => gate.factory(register => { register(c); throw new Error('SECRET'); }), /^Error: OWNED_READER_FAILED$/);
  const result = await gate.close();
  assert.deepEqual(result, { gateMeasurement: false, children: 1, allClosed: true, allNormal: false, signalAttempted: false });
  assert.deepEqual(c.signals, []);
});

test('missing close acknowledgement is bounded and never labeled normal', async () => {
  const gate = make(), c = child('never');
  gate.factory(register => { register(c); return { close: () => new Promise(() => {}), closed: false }; });
  const closing = gate.close();
  assert.equal(gate.close(), closing);
  assert.deepEqual(await closing, { gateMeasurement: false, children: 1, allClosed: false, allNormal: false, signalAttempted: true });
  assert.deepEqual(c.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(c.stdin.destroyed && c.stdout.destroyed && c.stderr.destroyed && c.unreffed);
});

test('signal attempt invalidates exit zero and blocks replacement construction', async () => {
  const gate = make(), c = child('signal-zero');
  gate.factory(register => { register(c); return { close: async () => {}, closed: false }; });
  assert.deepEqual(await gate.close(), { gateMeasurement: false, children: 1, allClosed: true, allNormal: false, signalAttempted: true });
  assert.deepEqual(c.signals, ['SIGTERM']);
  assert.throws(() => gate.factory(() => assert.fail('must not construct')), /OWNED_READER_FAILED/);
});

test('missing registration, extra children and stderr are fail-closed', async () => {
  const empty = make();
  assert.throws(() => empty.factory(() => ({})), /OWNED_READER_FAILED/);
  assert.equal((await empty.close()).allNormal, false);
  const extra = make(), a = child('normal'), b = child('normal');
  assert.throws(() => extra.factory(register => { register(a); register(b); return {}; }), /OWNED_READER_FAILED/);
  assert.equal((await extra.close()).allClosed, true);
  const noisy = make(), c = child('normal');
  const client = noisy.factory(register => { register(c); return { closed: false, close: async () => { c.stdin.end(); } }; });
  c.stderr.write('SECRET');
  assert.equal(client.closed, true);
  await assert.rejects(client.request('status'), /OWNED_READER_FAILED/);
  assert.equal((await noisy.close()).allNormal, false);
});

test('unexpected exit zero cannot be reused as a normal bootstrap close', async () => {
  const gate = make(), c = child('normal');
  gate.factory(register => { register(c); return { close: async () => {}, closed: false }; });
  c.emit('close', 0, null);
  assert.throws(() => gate.factory(() => assert.fail('must not construct')), /OWNED_READER_FAILED/);
  assert.equal((await gate.close()).allNormal, false);
});
