import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { superviseApiWorker } from './supervise-api-worker.mjs';
const worker = fileURLToPath(new URL('../tests/fixtures/nonlaunch-api-worker.mjs', import.meta.url));
const launch = mode => () => spawn(process.execPath, [worker, mode], { shell: false, stdio: 'pipe' });

test('parent supervises real HTTP session, reader bootstrap and normal cleanup', { timeout: 15000 }, async () => {
  const report = await superviseApiWorker(launch('normal'), { timeoutMs: 8000, graceMs: 2000 });
  assert.ok(report.sample && report.sample.messages === 1);
  assert.deepEqual({ ...report, sample: null }, { outcome: 'ok', gateMeasurement: false, workerClosed: true,
    workerCleanupReported: true, descendantStopConfirmed: false, signalAttempted: false, sample: null });
});

test('parent deadline sends EOF that interrupts pending history and reports cleanup without forced kill', { timeout: 15000 }, async () => {
  const report = await superviseApiWorker(launch('hold'), { timeoutMs: 1500, graceMs: 3000 });
  assert.equal(report.outcome, 'deadline');
  assert.equal(report.workerClosed, true);
  assert.equal(report.workerCleanupReported, true);
  assert.equal(report.signalAttempted, false);
  assert.equal(report.descendantStopConfirmed, false);
});

test('partial startup failure follows cleanup path and never reports a successful session', { timeout: 15000 }, async () => {
  const report = await superviseApiWorker(launch('startup-fail'), { timeoutMs: 8000, graceMs: 2000 });
  assert.notEqual(report.outcome, 'ok');
  assert.equal(report.workerClosed, true);
  assert.equal(report.workerCleanupReported, true);
  assert.equal(report.signalAttempted, false);
});

test('worker SIGTERM handler cancels its session and flushes a cleanup record', { timeout: 15000 }, async () => {
  let timer;
  try {
    const report = await superviseApiWorker(() => {
      const child = launch('hold')();
      timer = setTimeout(() => child.kill('SIGTERM'), 1500);
      return child;
    }, { timeoutMs: 8000, graceMs: 2000 });
    assert.notEqual(report.outcome, 'ok');
    assert.equal(report.workerClosed, true);
    assert.equal(report.workerCleanupReported, true);
    assert.equal(report.descendantStopConfirmed, false);
  } finally { clearTimeout(timer); }
});
