import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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
  assert.equal(result.sample !== null, mode === 'normal');
  if (mode === 'normal') assert.equal(result.sample.messages, 1);
});

test('cancellation after direct worker close still discards the registered sample', async () => {
  const controller = new AbortController();
  const result = await superviseRegisteredWorker(() => {
    const child = spawn(process.execPath, [fixture, 'normal', '--registry'], { shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    child.once('close', () => queueMicrotask(() => controller.abort()));
    return child;
  }, { timeoutMs: 8000, graceMs: 3000, signal: controller.signal });
  assert.equal(result.workerClosed, true);
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.sample, null);
});

test('a successful stdout report cannot bypass an empty private registry', async () => {
  const line = JSON.stringify({ event: 'complete', version: 2, sessionSucceeded: true, cleanupConfirmed: true,
    sample: { capabilitiesMs: 1, chatsMs: 2, historyMs: 3, cycleMs: 7, chats: 1, messages: 1, nonemptyHistory: true } }) + '\n';
  const result = await superviseRegisteredWorker(() => spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(line)})`], {
    shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  }));
  assert.equal(result.outcome, 'registry-incomplete');
  assert.equal(result.registryComplete, false);
  assert.equal(result.registeredResourcesAbsent, false);
  assert.equal(result.sample, null);
});

for (const count of [0, 1, 2, 3]) test(`crash after ${count} private registry frames never confirms absence`, { timeout: 5000 }, async () => {
  // Synthetic numeric frames intentionally have no real RPC children. Because
  // the registry is incomplete, none of these numeric PIDs may be probed.
  const partial = encode(frames.slice(0, count)).toString();
  const result = await superviseRegisteredWorker(() => spawn(process.execPath, ['-e',
    `require('node:fs').writeSync(3, ${JSON.stringify(partial)}); process.kill(process.pid, 'SIGKILL');`,
  ], { shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }), { timeoutMs: 1000, graceMs: 50, killWaitMs: 100 });
  assert.equal(result.outcome, 'exit');
  assert.equal(result.workerClosed, true);
  assert.equal(result.registryComplete, false);
  assert.equal(result.registeredResourcesAbsent, false);
  assert.equal(result.observationUncertain, true);
  assert.equal(result.safeToRelease, false);
});

test('inherited registry pipe without EOF is bounded, detached and never treated as complete', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 122, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    signals: [], unreffed: false, kill(s) { this.signals.push(s); }, unref() { this.unreffed = true; },
  });
  const privatePipe = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, privatePipe];
  const resultPromise = superviseRegisteredWorker(() => child, { timeoutMs: 10, graceMs: 10, killWaitMs: 10 });
  privatePipe.write(encode(frames)); // Complete frames, but deliberately no EOF.
  child.emit('exit', 0, null); // Direct worker gone; inherited descriptors persist.
  const result = await resultPromise;
  assert.equal(result.outcome, 'cleanup-unconfirmed');
  assert.equal(result.workerClosed, false);
  assert.equal(result.registryComplete, false);
  assert.equal(result.registeredResourcesAbsent, false);
  assert.equal(privatePipe.destroyed, true);
  assert.ok(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed);
  assert.equal(child.unreffed, true);
  assert.deepEqual(child.signals, []); // Do not target exited worker or descendants.
  const snapshot = JSON.stringify(result);
  child.emit('close', 0, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(result), snapshot);
});

test('missing registry pipe cancels and closes the already-owned worker', { timeout: 5000 }, async () => {
  const result = await superviseRegisteredWorker(() => spawn(process.execPath, ['-e', 'process.stdin.resume();'], {
    shell: false, stdio: 'pipe',
  }), { timeoutMs: 1000, graceMs: 200, killWaitMs: 200 });
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.workerClosed, true);
  assert.equal(result.registryComplete, false);
  assert.equal(result.registeredResourcesAbsent, false);
});
