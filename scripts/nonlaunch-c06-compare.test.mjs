// The comparison's job is to be wrong less often than a naive one would be.
// The tests that matter are the ones where a naive comparison declares a winner
// and this one refuses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareArms } from './nonlaunch-c06-compare.mjs';

// A supervisor report shaped like the real one, with the fields the comparison
// reads and nothing else.
function report(medians, { ok = true, certain = true, rssSelf = 1000, rssChild = 2000 } = {}) {
  const records = medians.map((ms, i) => ({ index: i + 1, cold: false, outcome: 'ok', cycleMs: ms }));
  return {
    outcome: ok ? 'ok' : 'failed',
    ownershipCertain: certain,
    report: {
      cyclesOk: records.length + 1,
      rssSelfMaxKb: rssSelf, rssChildMaxKb: rssChild,
      warm: { cycleMs: { n: records.length, median: medians[Math.floor(medians.length / 2)], p95: Math.max(...medians) } },
      records: [{ index: 0, cold: true, outcome: 'ok', cycleMs: 999 }, ...records],
    },
  };
}

const ARMS = [{ label: 'baseline' }, { label: 'candidate' }];

test('passes alternate so neither arm is always first', async () => {
  const order = [];
  await compareArms({ arms: ARMS, passes: 4,
    runPass: async (arm, ctx) => { order.push(`${ctx.pass}:${ctx.position}:${arm.label}`); return report([100, 100, 100]); } });
  assert.deepEqual(order, [
    '0:0:baseline', '0:1:candidate',
    '1:0:candidate', '1:1:baseline',
    '2:0:baseline', '2:1:candidate',
    '3:0:candidate', '3:1:baseline',
  ]);
});

test('a difference far larger than the within-arm spread is decidable', async () => {
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async (arm) => report(arm.label === 'baseline' ? [800, 810, 820] : [260, 265, 270]) });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.decidable, true);
  assert.match(r.verdict, /candidate is faster than baseline/);
  assert.ok(r.betweenArmDifference > 400);
});

test('a difference smaller than an arm\'s own drift is UNDECIDABLE, not a winner', async () => {
  // This is the J1 shape: an arm that drifts between passes by more than the
  // gap between arms. A naive comparison would announce a winner here.
  const byPass = { baseline: [[500, 500, 500], [900, 900, 900]], candidate: [[520, 520, 520], [560, 560, 560]] };
  const seen = { baseline: 0, candidate: 0 };
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async (arm) => report(byPass[arm.label][seen[arm.label]++]) });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.decidable, false);
  assert.match(r.verdict, /UNDECIDABLE/);
  assert.match(r.verdict, /disagrees with itself/);
  assert.ok(r.withinArmSpread.baseline > r.betweenArmDifference,
    'the guard must fire because within-arm drift exceeds the between-arm gap');
});

test('per-pass numbers are always present, since pooling is what hides drift', async () => {
  const seen = { baseline: 0, candidate: 0 };
  const byPass = { baseline: [[500, 500, 500], [900, 900, 900]], candidate: [[300, 300, 300], [310, 310, 310]] };
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async (arm) => report(byPass[arm.label][seen[arm.label]++]) });
  assert.equal(r.perPass.length, 4);
  assert.deepEqual(r.perPass.filter((p) => p.arm === 'baseline').map((p) => p.warmCycleMedian), [500, 900]);
  assert.equal(r.arms.baseline.withinArmSpread, 400);
});

test('one unclean pass voids the comparison rather than being averaged away', async () => {
  let n = 0;
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async () => (n++ === 2 ? report([100], { certain: false }) : report([100, 100, 100])) });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.arms, null);
  assert.match(r.verdict, /no comparison/);
  assert.equal(r.failedPasses.length, 1);
  // The per-pass detail survives, so a voided run is still diagnosable.
  assert.equal(r.perPass.length, 4);
});

test('a failed pass voids it too, not only an uncertain one', async () => {
  let n = 0;
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async () => (n++ === 1 ? report([100], { ok: false }) : report([100, 100, 100])) });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.failedPasses[0].outcome, 'failed');
});

test('memory maxima are carried through as maxima, not averages', async () => {
  const seen = { baseline: 0, candidate: 0 };
  const rss = { baseline: [1000, 5000], candidate: [2000, 2100] };
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async (arm) => report([100, 100, 100], { rssSelf: rss[arm.label][seen[arm.label]++] }) });
  assert.equal(r.arms.baseline.rssSelfMaxKb, 5000);
  assert.equal(r.arms.candidate.rssSelfMaxKb, 2100);
});

test('the comparison is never an acceptance', async () => {
  const r = await compareArms({ arms: ARMS, passes: 2,
    runPass: async (arm) => report(arm.label === 'baseline' ? [800, 800, 800] : [200, 200, 200]) });
  assert.equal(r.gateMeasurement, false);
});

for (const [name, options, code] of [
  ['one arm', { arms: [{ label: 'a' }], passes: 2 }, 'COMPARE_ARMS_INVALID'],
  ['three arms', { arms: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], passes: 2 }, 'COMPARE_ARMS_INVALID'],
  ['two arms with the same label', { arms: [{ label: 'a' }, { label: 'a' }], passes: 2 }, 'COMPARE_ARMS_INVALID'],
  // One pass gives an arm nothing to disagree with itself about, so the guard
  // could never fire and every result would look decidable.
  ['a single pass', { arms: ARMS, passes: 1 }, 'COMPARE_PASSES_INVALID'],
  ['a fractional pass count', { arms: ARMS, passes: 2.5 }, 'COMPARE_PASSES_INVALID'],
]) {
  test(`refuses ${name}`, async () => {
    await assert.rejects(() => compareArms({ ...options, runPass: async () => report([1]) }),
      (e) => e.code === code);
  });
}

test('refuses a missing runPass rather than producing an empty comparison', async () => {
  await assert.rejects(() => compareArms({ arms: ARMS, passes: 2 }),
    (e) => e.code === 'COMPARE_RUNPASS_INVALID');
});
