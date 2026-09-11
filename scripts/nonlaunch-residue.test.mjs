import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observeResidue } from './nonlaunch-residue.mjs';
const fixture = fileURLToPath(new URL('../tests/fixtures/residue-worker.mjs', import.meta.url));

async function setup(t) {
  const worker = spawn(process.execPath, [fixture], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  let closed = false;
  const done = new Promise(resolve => worker.once('close', () => { closed = true; resolve(); }));
  t.after(async () => {
    if (!closed) worker.kill('SIGKILL'); // Only the directly owned test worker.
    await done;
    // Grandchild is deliberately never signalled by numeric PID. It self-exits.
    await new Promise(resolve => setTimeout(resolve, 1900));
  });
  const record = await new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('fixture readiness timeout')), 3000);
    worker.stdout.on('data', chunk => {
      data += chunk;
      if (data.length > 256) { clearTimeout(timer); reject(new Error('fixture record too large')); }
      else if (data.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(data)); }
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { worker, done, registry: { pids: [worker.pid, record.pid], port: record.port, registryComplete: true } };
}

test('normal reaped worker/child and closed port can be observed absent', { timeout: 10000 }, async t => {
  const f = await setup(t);
  const active = await observeResidue(f.registry);
  assert.equal(active.processesAbsent, false); assert.equal(active.listenerAbsent, false);
  await f.done;
  const report = await observeResidue(f.registry);
  assert.deepEqual(report, { gateMeasurement: false, registryComplete: true, processesAbsent: true,
    listenerAbsent: true, observationUncertain: false, registeredResourcesAbsent: true, safeToRelease: false });
  assert.equal((await observeResidue({ ...f.registry, registryComplete: false })).registeredResourcesAbsent, false);
});

test('killing the worker does not hide its surviving child and listener', { timeout: 10000 }, async t => {
  const f = await setup(t);
  f.worker.kill('SIGKILL'); await f.done;
  const report = await observeResidue(f.registry);
  assert.equal(report.processesAbsent, false);
  assert.equal(report.listenerAbsent, false);
  assert.equal(report.registeredResourcesAbsent, false);
  assert.equal(report.safeToRelease, false);
  assert.ok(!JSON.stringify(report).includes(String(f.registry.port)));
});

test('rejects dangerous/duplicate PID and invalid port inputs before probing', async () => {
  for (const pids of [[0], [-1], [1], [2, 2], [], [2, 3, 4, 5]]) {
    await assert.rejects(observeResidue({ pids, port: 12345, registryComplete: true }), /RESIDUE_CONFIGURATION_REJECTED/);
  }
  await assert.rejects(observeResidue({ pids: [process.pid], port: 0, registryComplete: true }), /RESIDUE_CONFIGURATION_REJECTED/);
});
