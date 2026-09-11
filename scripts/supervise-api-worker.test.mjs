import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { superviseApiWorker } from './supervise-api-worker.mjs';
const complete = JSON.stringify({ event: 'complete', sessionSucceeded: true, cleanupConfirmed: true }) + '\n';
const limits = { timeoutMs: 1000, graceMs: 80, killWaitMs: 500 };
async function run(body, options = {}) {
  const report = await superviseApiWorker(() => spawn(process.execPath, ['-e', body], { shell: false, stdio: 'pipe' }), { ...limits, ...options });
  assert.equal(report.workerClosed, true);
  assert.equal(report.gateMeasurement, false);
  assert.equal(report.descendantStopConfirmed, false);
  assert.ok(!JSON.stringify(report).includes('SECRET'));
  return report;
}

test('accepts only a complete record followed by normal exit', async () => {
  assert.equal((await run(`process.stdout.write(${JSON.stringify(complete)});`)).outcome, 'ok');
  assert.equal((await run(`process.stdout.write(${JSON.stringify(complete)}); process.exitCode = 2;`)).outcome, 'exit');
  assert.equal((await run('process.exitCode = 0;')).outcome, 'protocol');
});

test('rejects duplicate/trailing/oversized/secret diagnostics and false cleanup reports', async () => {
  for (const body of [
    `process.stdout.write(${JSON.stringify(complete + complete)});`,
    `process.stdout.write(${JSON.stringify(complete + 'SECRET')});`,
    `process.stdout.write('x'.repeat(1025));`,
    `process.stderr.write('SECRET');`,
    `process.stdout.write(${JSON.stringify(complete.replace('true', 'false'))});`,
  ]) assert.notEqual((await run(body)).outcome, 'ok');
});

test('v2 validates numeric samples but lifecycle-only public entry never exports them', async () => {
  const sample = { capabilitiesMs: 1, chatsMs: 2, historyMs: 3, cycleMs: 7,
    chats: 1, messages: 1, nonemptyHistory: true };
  const message = { event: 'complete', version: 2, sessionSucceeded: true, cleanupConfirmed: true, sample };
  const body = value => `process.stdout.write(${JSON.stringify(JSON.stringify(value) + '\n')});`;
  assert.equal((await run(body(message))).sample, null);
  assert.equal((await run(`process.stdout.write(${JSON.stringify(complete)});`)).sample, null);
  for (const invalid of [
    { ...message, version: 3 }, { ...message, sample: null },
    { ...message, sample: { ...sample, text: 'SECRET' } },
    { ...message, sample: { ...sample, cycleMs: 1 } },
    { ...message, cleanupConfirmed: false },
  ]) {
    const report = await run(body(invalid));
    assert.notEqual(report.outcome, 'ok');
    assert.equal(report.sample, null);
  }
  for (const suffix of ['process.exitCode = 2;', 'process.stderr.write("SECRET");', 'setInterval(() => {}, 1000);']) {
    const report = await run(body(message) + suffix, { timeoutMs: 200 });
    assert.notEqual(report.outcome, 'ok');
    assert.equal(report.sample, null);
  }
});

test('parent deadline works when child event loop is synchronously blocked', { timeout: 5000 }, async () => {
  const report = await run('process.on("SIGTERM", () => {}); while (true) {}', { timeoutMs: 200 });
  assert.equal(report.outcome, 'deadline');
  assert.equal(report.signalAttempted, true);
  assert.equal(report.workerCleanupReported, false);
});

test('external cancellation and pre-abort prevent a successful result', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try { assert.equal((await run('setInterval(() => {}, 1000);', { signal: controller.signal })).outcome, 'interrupted'); }
  finally { clearTimeout(timer); }
  const report = await superviseApiWorker(() => assert.fail('must not spawn'), { signal: AbortSignal.abort() });
  assert.equal(report.outcome, 'interrupted');
});

test('worker exit without stdio close remains unconfirmed and never signals descendants', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), signals: [], unref() {}, kill(s) { this.signals.push(s); } });
  const pending = superviseApiWorker(() => child, { timeoutMs: 5, graceMs: 5, killWaitMs: 5 });
  child.emit('exit', 0, null);
  const report = await pending;
  assert.equal(report.outcome, 'cleanup-unconfirmed');
  assert.equal(report.workerClosed, false);
  assert.deepEqual(child.signals, []);
  assert.ok(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed);
});

test('spawn failure is fixed-category and invalid timing is rejected before construction', async () => {
  assert.equal((await superviseApiWorker(() => { throw new Error('SECRET'); })).outcome, 'spawn');
  assert.throws(() => superviseApiWorker(() => assert.fail('must not spawn'), { timeoutMs: NaN }), /WORKER_CONFIGURATION_REJECTED/);
});
