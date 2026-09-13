// Counterbalanced comparison of two arms at the application level.
//
// J1 measured this project's own need for it. Across two passes at the RPC
// level the baseline's wall time went 4663ms -> 5872ms, a 26% drift, while the
// candidate moved 2%. Run as "all of one arm, then all of the other", that
// drift sits entirely inside the comparison and reads as part of the effect.
//
// So: passes alternate, every pass is reported separately, and the pooled
// numbers are never shown without the per-pass ones that would expose drift.
//
// The guard that matters is the timing analogue of parity's INCONCLUSIVE.
// Parity can demand exact equality; timing cannot, because it always varies.
// What it can demand is that the variation BETWEEN arms be larger than the
// variation an arm shows against ITSELF across passes. When it is not, the
// comparison is reported UNDECIDABLE rather than as a winner, because a
// difference smaller than the noise is not a difference that was measured.
//
// Every pass is a complete launch/soak/cleanup of its own. Arms never share an
// application, a session, a reader gate or a child process.

const round = (n) => Math.round(n * 10) / 10;
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

const failure = (code) => Object.assign(new Error(code), { code });

/**
 * @param arms     [{ label, ... }, { label, ... }] — exactly two
 * @param passes   how many times each arm runs. At least two, or an arm has
 *                 nothing to disagree with itself about and the guard below
 *                 cannot fire at all.
 * @param runPass  (arm, context) => the supervisor report for one pass
 */
export async function compareArms({ arms, passes = 2, runPass }) {
  if (!Array.isArray(arms) || arms.length !== 2) throw failure('COMPARE_ARMS_INVALID');
  if (arms[0]?.label === arms[1]?.label) throw failure('COMPARE_ARMS_INVALID');
  if (!arms.every((a) => typeof a?.label === 'string' && a.label)) throw failure('COMPARE_ARMS_INVALID');
  if (!Number.isInteger(passes) || passes < 2 || passes > 20) throw failure('COMPARE_PASSES_INVALID');
  if (typeof runPass !== 'function') throw failure('COMPARE_RUNPASS_INVALID');

  const results = [];
  for (let pass = 0; pass < passes; pass += 1) {
    // Alternate, so neither arm is always first and neither always inherits a
    // warm page cache or a cooler CPU from the other.
    const order = pass % 2 === 0 ? [arms[0], arms[1]] : [arms[1], arms[0]];
    for (const arm of order) {
      const report = await runPass(arm, { pass, position: order.indexOf(arm) });
      results.push({ arm: arm.label, pass, position: order.indexOf(arm), report });
    }
  }

  const byArm = new Map(arms.map((a) => [a.label, results.filter((r) => r.arm === a.label)]));
  const failed = results.filter((r) => r.report?.outcome !== 'ok' || r.report?.ownershipCertain !== true);

  const perPass = results.map((r) => ({
    arm: r.arm, pass: r.pass, position: r.position,
    outcome: r.report?.outcome ?? 'missing',
    ownershipCertain: r.report?.ownershipCertain ?? false,
    warmCycleMedian: r.report?.report?.warm?.cycleMs?.median ?? null,
    warmCycleP95: r.report?.report?.warm?.cycleMs?.p95 ?? null,
    warmSamples: r.report?.report?.warm?.cycleMs?.n ?? 0,
    cyclesOk: r.report?.report?.cyclesOk ?? 0,
    rssSelfMaxKb: r.report?.report?.rssSelfMaxKb ?? null,
    rssChildMaxKb: r.report?.report?.rssChildMaxKb ?? null,
  }));

  if (failed.length > 0) {
    return {
      outcome: 'failed', gateMeasurement: false, verdict: 'no comparison: at least one pass did not complete cleanly',
      failedPasses: failed.map((f) => ({ arm: f.arm, pass: f.pass,
        outcome: f.report?.outcome ?? 'missing', ownershipCertain: f.report?.ownershipCertain ?? false })),
      perPass, arms: null, withinArmSpread: null, betweenArmDifference: null,
    };
  }

  const armStats = {};
  for (const [label, rows] of byArm) {
    const perPassMedians = rows.map((r) => r.report.report.warm.cycleMs.median);
    const pooled = rows.flatMap((r) => r.report.report.records.filter((c) => !c.cold && c.outcome === 'ok').map((c) => c.cycleMs));
    armStats[label] = {
      perPassMedians,
      // An arm's disagreement with itself, in the same units as the effect.
      withinArmSpread: round(Math.max(...perPassMedians) - Math.min(...perPassMedians)),
      pooledMedian: median(pooled),
      pooledSamples: pooled.length,
      rssSelfMaxKb: Math.max(...rows.map((r) => r.report.report.rssSelfMaxKb ?? 0)),
      rssChildMaxKb: Math.max(...rows.map((r) => r.report.report.rssChildMaxKb ?? 0)),
    };
  }

  const [a, b] = arms.map((x) => x.label);
  const betweenArmDifference = round(Math.abs(armStats[a].pooledMedian - armStats[b].pooledMedian));
  const worstWithin = Math.max(armStats[a].withinArmSpread, armStats[b].withinArmSpread);
  const decidable = betweenArmDifference > worstWithin;

  const faster = armStats[a].pooledMedian < armStats[b].pooledMedian ? a : b;
  const slower = faster === a ? b : a;

  return {
    outcome: 'ok',
    // Still never an acceptance. A comparison between two arms says nothing
    // about whether either meets a threshold.
    gateMeasurement: false,
    decidable,
    verdict: decidable
      ? `${faster} is faster than ${slower} by ${betweenArmDifference}ms at the pooled warm median`
      : `UNDECIDABLE: the arms differ by ${betweenArmDifference}ms but an arm disagrees with itself by up to ${worstWithin}ms across passes, so the difference is not larger than the noise`,
    betweenArmDifference,
    withinArmSpread: { [a]: armStats[a].withinArmSpread, [b]: armStats[b].withinArmSpread },
    arms: armStats,
    // Always alongside the pooled numbers, never instead of them: this is where
    // drift is visible, and pooling is what hides it.
    perPass,
  };
}
