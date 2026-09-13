// The soak runner's job is to produce numbers someone will later make a
// release decision from. Each test here exists because a specific way of
// producing a WRONG number was already made once, in the historical a342425
// probe, and is recorded in p0c-acceptance.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runC06Soak } from './nonlaunch-c06-soak.mjs';

const COOKIE = 'A'.repeat(43);
// The transport only permits history paths whose id is the application's
// 43-character token shape, so the fake's chat id has to be one. A shorter id
// made every cycle fail at the history stage.
const CHAT_ID = 'c'.repeat(43);
const ORIGIN = 'https://example.invalid';

function body(path, delayMs) {
  if (path.startsWith('/api/capabilities')) {
    return {
      epoch: 'epoch1', mode: 'readonly',
      features: {
        chats: { state: 'available' }, history: { state: 'available' },
        read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
        typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
      },
    };
  }
  if (path.startsWith('/api/chats?')) {
    return { epoch: 'epoch1', limit: 50, chats: [{ id: CHAT_ID, name: 'n', service: 'iMessage',
      isGroup: false, unreadCount: 0, lastMessageAt: null, trimmed: false }] };
  }
  return { epoch: 'epoch1', limit: 50, messages: [{ id: 'msg1', text: 't', isFromMe: false,
    createdAt: null, trimmed: false }] };
}

// A fake application: exactly the three routes the workload validates, plus a
// controllable per-request delay so a cycle can be made to overrun its slot.
async function startFake({ delayMs = 0, failAfter = Infinity } = {}) {
  let served = 0;
  const server = createServer((req, res) => {
    served += 1;
    const send = () => {
      if (served > failAfter) { res.writeHead(500).end('{}'); return; }
      const payload = JSON.stringify(body(req.url));
      res.writeHead(200, { 'content-type': 'application/json' }).end(payload);
    };
    if (delayMs) setTimeout(send, delayMs); else send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  return {
    app: { server, close: async () => { closed = true; await new Promise(r => server.close(r)); } },
    isClosed: () => closed,
    served: () => served,
  };
}

function fakeParts({ childPids = [], rssFor = null } = {}) {
  let sessions = 1;
  return {
    auth: { login: () => ({ cookie: COOKIE }), revokeAll() { sessions = 0; }, get count() { return sessions; } },
    source: { close: async () => {} },
    readers: {
      livePids: () => childPids,
      close: async () => ({ allClosed: true, allNormal: true, signalAttempted: false }),
    },
    sampleRss: rssFor ?? (pids => new Map(pids.map(p => [p, 1024]))),
  };
}

const base = (fake, parts, extra) => ({
  app: fake.app, auth: parts.auth, source: parts.source, readers: parts.readers,
  key: 'k', origin: ORIGIN, sampleRss: parts.sampleRss,
  selfRss: () => 50 * 1024 * 1024,
  durationMs: 900, intervalMs: 100, rssIntervalMs: 50, timeoutMs: 5_000, cleanupMs: 5_000,
  ...extra,
});

test('a normal soak keeps every raw record and separates cold from warm', async () => {
  const fake = await startFake();
  const parts = fakeParts({ childPids: [111] });
  const r = await runC06Soak(base(fake, parts));
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.equal(r.gateMeasurement, false);
  assert.ok(r.cyclesOk >= 3, `expected several cycles, got ${r.cyclesOk}`);
  // Defect 3: summaries must never replace the raw records.
  assert.equal(r.records.length, r.cyclesAttempted);
  assert.ok(r.records.every(c => typeof c.capabilitiesMs === 'number'), 'per-stage timings retained');
  assert.equal(r.records[0].cold, true);
  assert.equal(r.warm.cycleMs.n, r.cyclesOk - 1, 'the cold cycle is excluded from warm stats');
  assert.ok(typeof r.coldCycleMs === 'number');
  assert.ok(Object.values(r.cleanup).every(Boolean), JSON.stringify(r.cleanup));
  assert.equal(fake.isClosed(), true);
});

test('actual elapsed time is measured, not the requested duration echoed back', async () => {
  const fake = await startFake();
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts, { durationMs: 400 }));
  // Defect 4: the old probe reported the requested duration as if it were real.
  assert.equal(r.requestedDurationMs, 400);
  assert.notEqual(r.actualElapsedMs, 400);
  assert.ok(r.actualElapsedMs > 0);
});

test('memory is sampled on its own clock and does not wait for a cycle', async () => {
  // Defect 1: the old probe shared one serial loop, so reads added jitter to
  // sampling and sampling added jitter to reads. rssInterval is a quarter of
  // the cycle interval here, so a shared loop could not produce this ratio.
  const fake = await startFake({ delayMs: 40 });
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts, { durationMs: 800, intervalMs: 200, rssIntervalMs: 50 }));
  assert.ok(r.rssSamples > r.cyclesAttempted * 2,
    `expected sampling to outpace cycles: ${r.rssSamples} samples vs ${r.cyclesAttempted} cycles`);
  assert.ok(r.rssSelfMaxKb > 0);
});

test('a child the gate registered but sampling could not see is counted as a miss', async () => {
  // Defect 2: a snapshot cannot prove a transient child was absent. It can at
  // least say it failed to see one it was told about.
  const fake = await startFake();
  const parts = fakeParts({ childPids: [222], rssFor: () => new Map() });
  const r = await runC06Soak(base(fake, parts));
  assert.ok(r.rssMisses > 0, 'an unsampled registered child must be reported');
});

test('a cycle that overruns its slot is recorded as skipped, not queued', async () => {
  const fake = await startFake({ delayMs: 120 });
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts, { durationMs: 900, intervalMs: 60 }));
  assert.ok(r.skippedSlots > 0, 'slots must be dropped rather than stretching the schedule');
  assert.equal(r.records.every(c => c.startedAt >= 0), true);
});

test('a failed cycle ends the soak and the run is not ok', async () => {
  const fake = await startFake({ failAfter: 4 });
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts));
  assert.equal(r.outcome, 'failed');
  assert.ok(r.failedCycles >= 1);
  assert.ok(Object.values(r.cleanup).every(Boolean), 'cleanup still runs on failure');
});

test('a soak that runs to its requested duration says so; one cut short does not', async () => {
  const full = await startFake();
  const r1 = await runC06Soak(base(full, fakeParts(), { durationMs: 400, intervalMs: 100 }));
  assert.equal(r1.reachedDuration, true, 'a completed soak must report reaching its duration');
  const short = await startFake({ failAfter: 4 });
  const r2 = await runC06Soak(base(short, fakeParts(), { durationMs: 5_000, intervalMs: 100 }));
  assert.equal(r2.reachedDuration, false, 'a soak ended by a failed cycle has not reached it');
});

test('an abort is reported and cannot be upgraded to ok', async () => {
  const fake = await startFake();
  const parts = fakeParts();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const r = await runC06Soak(base(fake, parts, { durationMs: 5_000, signal: controller.signal }));
  assert.equal(r.interrupted, true);
  assert.equal(r.outcome, 'failed');
});

test('an unclosed application is never reported as a clean run', async () => {
  const fake = await startFake();
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts, {
    app: { server: fake.app.server, close: async () => { throw new Error('stuck'); } },
  }));
  assert.equal(r.cleanup.appClosed, false);
  assert.equal(r.outcome, 'failed');
  await fake.app.close();
});

for (const [name, extra] of [
  ['a duration of zero', { durationMs: 0 }],
  ['an interval longer than the duration', { durationMs: 100, intervalMs: 500 }],
  ['a non-integer interval', { intervalMs: 12.5 }],
  ['a signal that is not an AbortSignal', { signal: {} }],
]) {
  test(`refuses ${name}`, async () => {
    const fake = await startFake();
    const parts = fakeParts();
    const r = await runC06Soak(base(fake, parts, extra));
    assert.equal(r.outcome, 'failed');
    assert.equal(r.configInvalid, true);
    await fake.app.close().catch(() => {});
  });
}

test('refuses a listener that is not loopback', async () => {
  const fake = await startFake();
  const parts = fakeParts();
  const r = await runC06Soak(base(fake, parts, {
    app: { server: { listening: true, address: () => ({ address: '0.0.0.0', port: 1 }) },
      close: async () => {} },
  }));
  assert.equal(r.startupFailed, true);
  assert.equal(r.outcome, 'failed');
  await fake.app.close();
});
