import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRegistryDecoder, superviseRegisteredWorker } from './nonlaunch-registry.mjs';
const frames = [{ event: 'listener', port: 12345 }, { event: 'child', pid: 123 }, { event: 'child', pid: 124 }, { event: 'sealed' }];
const encode = rows => Buffer.from(rows.map(r => JSON.stringify(r) + '\n').join(''));

test('requires bounded ordered registration, seal and EOF even with fragmented frames', () => {
  const d = createRegistryDecoder(122);
  for (const byte of encode(frames)) d.push(Buffer.from([byte]));
  assert.equal(d.snapshot().registryComplete, false);
  d.end();
  assert.deepEqual(d.snapshot(), { pids: [122, 123, 124], port: 12345, registryComplete: true });
  for (let n = 0; n < 4; n++) {
    const partial = createRegistryDecoder(122); partial.push(encode(frames.slice(0, n))); partial.end();
    assert.equal(partial.snapshot().registryComplete, false);
  }
});

test('rejects forged shapes, duplicate PID, early seal, extra data and overflow', () => {
  for (const rows of [
    [frames[1]], [frames[0], frames[3]], [frames[0], frames[1], frames[1]],
    [frames[0], { event: 'child', pid: 122 }], [...frames, frames[3]],
    [{ ...frames[0], secret: 'SYNTHETIC' }],
  ]) {
    const d = createRegistryDecoder(122);
    assert.throws(() => d.push(encode(rows)), /REGISTRY_REJECTED/);
    assert.equal(d.snapshot().registryComplete, false);
  }
  const d = createRegistryDecoder(122);
  assert.throws(() => d.push(Buffer.alloc(1025)), /REGISTRY_REJECTED/);
  const partial = createRegistryDecoder(122); partial.push(Buffer.from('{'));
  assert.throws(() => partial.end(), /REGISTRY_REJECTED/);
});

const fixture = fileURLToPath(new URL('../tests/fixtures/nonlaunch-api-worker.mjs', import.meta.url));
for (const mode of ['normal', 'hold', 'startup-fail']) test(`private registry joins actual ${mode} worker to external absence checks`, { timeout: 15000 }, async () => {
  const result = await superviseRegisteredWorker(() => spawn(process.execPath, [fixture, mode, '--registry'], {
    shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  }), { timeoutMs: mode === 'hold' ? 1500 : 8000, graceMs: 3000 });
  assert.equal(result.workerClosed, true);
  assert.equal(result.registryComplete, mode !== 'startup-fail');
  assert.equal(result.registeredResourcesAbsent, mode !== 'startup-fail');
  assert.equal(result.outcome, mode === 'normal' ? 'ok' : mode === 'hold' ? 'deadline' : 'exit');
  assert.equal(result.safeToRelease, false);
  assert.equal(result.descendantStopConfirmed, false);
});

test('a successful stdout report cannot bypass an empty private registry', async () => {
  const line = JSON.stringify({ event: 'complete', sessionSucceeded: true, cleanupConfirmed: true }) + '\n';
  const result = await superviseRegisteredWorker(() => spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(line)})`], {
    shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  }));
  assert.equal(result.outcome, 'registry-incomplete');
  assert.equal(result.registryComplete, false);
  assert.equal(result.registeredResourcesAbsent, false);
});
