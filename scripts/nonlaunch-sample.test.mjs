import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSample } from './nonlaunch-sample.mjs';

const sample = { capabilitiesMs: 1.1, chatsMs: 2.2, historyMs: 3.3, cycleMs: 7,
  chats: 50, messages: 1, nonemptyHistory: true };

test('numeric sample projects a fresh fixed record and permits empty history', () => {
  assert.deepEqual(validateSample(sample), sample);
  assert.notEqual(validateSample(sample), sample);
  assert.equal(validateSample({ ...sample, messages: 0, nonemptyHistory: false }).messages, 0);
});

test('rejects extra data, invalid timings, counts and inconsistent flags', () => {
  for (const value of [null, [], { ...sample, text: 'SECRET' },
    ...[NaN, Infinity, -1, 60000.1, 1.11, '1'].map(capabilitiesMs => ({ ...sample, capabilitiesMs })),
    { ...sample, cycleMs: 3 }, { ...sample, cycleMs: 6 },
    { ...sample, chats: 0 }, { ...sample, chats: 51 }, { ...sample, chats: 1.5 },
    { ...sample, messages: -1 }, { ...sample, messages: 51 },
    { ...sample, nonemptyHistory: false }, { ...sample, messages: 0 },
  ]) assert.throws(() => validateSample(value), /SAMPLE_REJECTED/);
});
