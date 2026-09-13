// End-to-end: admission -> isolated launcher -> soak -> supervisor, against a
// synthetic imsg. No Mac, no real imsg, no Messages data.
//
// The supervisor's one job that nothing else can do is to refuse to claim
// cleanup it did not watch. Most of these tests are about that refusal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { superviseC06 } from './nonlaunch-c06-supervise.mjs';
import { launchIsolated, psRss } from './nonlaunch-c06-launcher.mjs';
import { runC06Soak } from './nonlaunch-c06-soak.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'dist');
const ORIGIN = 'https://example.invalid';

// A synthetic imsg: the five allow-listed read methods, no data of any kind.
const FAKE = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
// The application spawns \`rpc\` with no --db, so indexOf returns -1 and
// argv[0] -- the node path -- came back as the database. LiveSource compares
// the reported path against the one derived from the passwd home and rejected
// it, which surfaced as a capabilities failure two layers up.
const db = process.env.FAKE_DB_PATH;
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  const r = JSON.parse(line);
  let result;
  // 0.15.1 deliberately: capabilities.ts lists 0.14.2 and 0.15.1 as tested, so a
  // fake reporting 0.15.4 makes every read capability VERSION_UNTESTED and the
  // cycle fails at the capabilities stage. That is a real finding about the
  // application -- see docs/step3-c06-harness.md -- and not something this test
  // should paper over by being the only place the version list is widened.
  if (r.method === 'status') result = { version: '0.15.1', protocol_version: 1,
    database: { ready: true, path: db }, bridge: { ready: false },
    contacts: { available: false },
    methods: ['status','chats.list','messages.history','watch.subscribe','watch.unsubscribe'] };
  if (r.method === 'chats.list') result = { chats: Array.from({ length: 3 }, (_, i) => ({
    id: i + 1, guid: 'g' + i, name: 'Synthetic ' + i, service: 'iMessage' })) };
  if (r.method === 'messages.history') result = { messages: [{ id: 1,
    chat_id: r.params.chat_id, guid: 'm1', text: 'SYNTHETIC', is_from_me: false }] };
  if (r.method === 'watch.subscribe') result = { subscription: 1 };
  if (r.method === 'watch.unsubscribe') result = { ok: true };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\\n');
});
`;

function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'c06-e2e-'));
  const exe = join(dir, 'fake-imsg.mjs');
  writeFileSync(exe, FAKE, { mode: 0o700 });
  chmodSync(exe, 0o700);
  const sha256 = createHash('sha256').update(readFileSync(exe)).digest('hex');
  return { dir, exe, sha256, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The fake is a .mjs, so it is launched through this Node. Real runs name the
// admitted imsg binary directly; the shape of the check is the same either way.
async function launchFake(s, databasePath) {
  const shim = join(s.dir, 'imsg-shim');
  writeFileSync(shim,
    `#!/bin/sh\nFAKE_DB_PATH='${databasePath}' exec ${process.execPath} ${s.exe} "$@"\n`,
    { mode: 0o700 });
  chmodSync(shim, 0o700);
  const sha256 = createHash('sha256').update(readFileSync(shim)).digest('hex');
  return launchIsolated({
    dist: DIST, executable: shim, sha256, stateDir: s.dir, origin: ORIGIN, databasePath,
  });
}

// LiveSource does not merely compare the reported database path: it FINGERPRINTS
// the file, so the path must exist for the end-to-end run. That check is the one
// turning "imsg opened a different chat.db and succeeded" into a failure, so the
// test makes the file rather than the launcher relaxing the check.
async function withSyntheticDatabase(t) {
  const { homedir } = (await import('node:os')).userInfo();
  const dir = `${homedir}/Library/Messages`;
  const path = `${dir}/chat.db`;
  if (existsSync(path)) return path; // never overwrite something already there
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, '', { mode: 0o600 });
  t.after(() => { try { rmSync(path); } catch {} });
  return path;
}

test('a full run reports ok, certain ownership and an admission record', async (t) => {
  const s = stage();
  t.after(() => s.cleanup());
  const dbPath = await withSyntheticDatabase(t);

  const result = await superviseC06({
    hardLimitMs: 60_000,
    proc: new EventEmitter(),
    launch: () => launchFake(s, dbPath),
    soak: (l, signal) => runC06Soak({
      app: l.app, auth: l.auth, source: l.source, readers: l.readers,
      key: l.key, origin: l.origin, sampleRss: psRss, signal,
      durationMs: 700, intervalMs: 150, rssIntervalMs: 50, cleanupMs: 5_000,
    }),
  });

  assert.equal(result.outcome, 'ok', JSON.stringify(result.report ?? result, null, 1).slice(0, 1200));
  assert.equal(result.ownershipCertain, true);
  assert.equal(result.watchdogFired, false);
  assert.equal(result.gateMeasurement, false);
  assert.equal(result.admission.provenanceEstablished, false);
  assert.equal(result.admission.admitted[0].label, 'imsg');
  assert.ok(result.report.cyclesOk >= 2, `cycles: ${result.report.cyclesOk}`);
  assert.ok(result.report.warm.cycleMs.n >= 1);
  assert.match(result.residueClaim, /observed to complete/);
});

test('the watchdog never claims cleanup it did not watch', async () => {
  const result = await superviseC06({
    hardLimitMs: 60,
    proc: new EventEmitter(),
    launch: async () => ({ admission: null }),
    // Work that never settles: the case the soak's own bounds cannot cover.
    soak: () => new Promise(() => {}),
  });
  assert.equal(result.watchdogFired, true);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.ownershipCertain, false);
  assert.equal(result.report, null);
  assert.match(result.residueClaim, /must not be read as evidence that processes exited/);
});

test('a signal aborts the soak rather than killing the run, and is recorded', async () => {
  const proc = new EventEmitter();
  let sawAbort = false;
  const result = await superviseC06({
    hardLimitMs: 60_000,
    proc,
    launch: async () => ({ admission: null }),
    soak: (_l, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        sawAbort = true;
        resolve({ outcome: 'failed', interrupted: true, cleanup: { a: true } });
      });
      setTimeout(() => proc.emit('SIGTERM'), 20);
    }),
  });
  assert.equal(sawAbort, true, 'the soak must receive the abort');
  assert.deepEqual(result.signals, ['SIGTERM']);
  assert.equal(result.interrupted, true);
  assert.equal(result.outcome, 'failed');
});

test('signal handlers are removed again, so a run leaves no listener behind', async () => {
  const proc = new EventEmitter();
  await superviseC06({
    hardLimitMs: 1_000, proc,
    launch: async () => ({ admission: null }),
    soak: async () => ({ outcome: 'ok', cleanup: { a: true } }),
  });
  assert.equal(proc.listenerCount('SIGINT'), 0);
  assert.equal(proc.listenerCount('SIGTERM'), 0);
});

test('an incomplete cleanup is never reported as certain ownership', async () => {
  const result = await superviseC06({
    hardLimitMs: 1_000,
    proc: new EventEmitter(),
    launch: async () => ({ admission: null }),
    soak: async () => ({ outcome: 'ok', cleanup: { revoked: true, appClosed: false } }),
  });
  assert.equal(result.ownershipCertain, false);
  assert.match(result.residueClaim, /did not complete/);
});

test('a launch failure is reported as such and never as a soak result', async () => {
  const result = await superviseC06({
    hardLimitMs: 1_000,
    proc: new EventEmitter(),
    launch: async () => { throw Object.assign(new Error('x'), { code: 'ADMISSION_DIGEST_MISMATCH' }); },
    soak: async () => { throw new Error('must not be reached'); },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.launchFailed, 'ADMISSION_DIGEST_MISMATCH');
  assert.equal(result.report, null);
});

test('the launcher refuses an executable whose digest does not match', async (t) => {
  const s = stage();
  t.after(() => s.cleanup());
  await assert.rejects(() => launchIsolated({
    dist: DIST, executable: s.exe, sha256: '0'.repeat(64),
    stateDir: s.dir, origin: ORIGIN, databasePath: '/x',
  }), (e) => e.code === 'ADMISSION_DIGEST_MISMATCH');
});

for (const bad of [0, -1, 1.5, '1000', undefined]) {
  test(`refuses a hard limit of ${JSON.stringify(bad)}`, async () => {
    await assert.rejects(() => superviseC06({
      hardLimitMs: bad, proc: new EventEmitter(),
      launch: async () => ({}), soak: async () => ({}),
    }), (e) => e.code === 'SUPERVISE_INVALID');
  });
}

test('psRss refuses pids that are not positive integers', () => {
  assert.throws(() => psRss([0]), (e) => e.code === 'RSS_PIDS_INVALID');
  assert.throws(() => psRss([1.5]), (e) => e.code === 'RSS_PIDS_INVALID');
  assert.deepEqual([...psRss([])], []);
  // Our own pid must be readable, or the sampler would silently report nothing.
  assert.ok(psRss([process.pid]).get(process.pid) > 0);
});
