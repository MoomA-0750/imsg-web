import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measured, summary, cleanup } from './diagnose-performance.mjs';
test('measured events exclude result and private errors', async () => {
  const events = [], payload = { text: 'SYNTHETIC_PRIVATE_BODY', key: 'SYNTHETIC_SECRET' };
  assert.equal(await measured(events, 'status', async () => payload), payload);
  await assert.rejects(measured(events, 'messages.history', async () => { throw new Error(payload.text); }));
  assert.deepEqual(events.map(e => [e.stage, e.ok]), [['status', true], ['messages.history', false]]);
  for (const e of events) { assert.deepEqual(Object.keys(e).sort(), ['ms', 'ok', 'stage']); assert.ok(e.ms >= 0); }
  assert.ok(!JSON.stringify(events).includes('SYNTHETIC'));
});
test('unknown methods cannot be dispatched by instrumentation', async () => {
  let invoked = false;
  await assert.rejects(measured([], 'send', async () => { invoked = true; }));
  assert.equal(invoked, false);
});
test('six-sample diagnostic reports min/max, not acceptance p95', () => {
  const values = [6, 5, 4, 3, 2, 1];
  assert.deepEqual(summary(values), { count: 6, minMs: 1, maxMs: 6 });
  assert.equal(values[0], 6); assert.throws(() => summary([])); assert.throws(() => summary([NaN]));
});
for (const failure of [null, 'revoke', 'close', 'verify']) test(`cleanup always attempts all steps and reports ${failure ?? 'success'}`, async () => {
  const attempted = [], output = [];
  const callbacks = Object.fromEntries(['revoke', 'close', 'verify'].map(name => [name, async () => { attempted.push(name); if (failure === name) throw new Error('SYNTHETIC_SECRET'); }]));
  const done = cleanup(callbacks, row => output.push(row));
  if (failure) await assert.rejects(done); else await done;
  assert.deepEqual(attempted, ['revoke', 'close', 'verify']); assert.equal(output.length, 1);
  assert.equal(output[0].cleanup, failure ? 'unconfirmed' : 'confirmed');
  assert.ok(!JSON.stringify(output).includes('SYNTHETIC'));
});
