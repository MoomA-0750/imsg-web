import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { probe, verifyArtifact } from './custom-read-preflight.mjs';

const order = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A'];
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(payload, key) {
  const hash = value => createHmac('sha256', key).update(canonical(value)).digest('hex');
  const nonNames = { ...payload, chats: payload.chats.map(({ contact_name, ...rest }) => rest) };
  const names = payload.chats.map(c => Object.hasOwn(c, 'contact_name') ? [true, c.contact_name] : [false]);
  return { payload: hash(nonNames), names: hash(names) };
}
function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2, min: sorted[0], max: sorted[n-1] };
}

// execute returns only the fixed probe result; fingerprints remain private here.
export async function compare(execute) {
  const key = randomBytes(32), samples = [], pairs = [], prints = [];
  const preflights = [];
  let complete = true;
  try {
    for (const arm of ['A','B']) {
      const r = await execute(arm, 1, () => {});
      preflights.push({ arm, ...r });
      if (r.outcome !== 'ok') { complete = false; break; }
    }
    if (complete) for (const arm of order) {
      let mark;
      const r = await execute(arm, 50, data => { mark = fingerprint(data, key); });
      samples.push({ arm, ...r }); prints.push(mark);
      if (r.outcome !== 'ok' || !mark) { complete = false; break; }
    }
    for (let i=0; i+1<samples.length; i+=2) {
      const ok = samples[i].outcome === 'ok' && samples[i+1].outcome === 'ok';
      const payloadEqual = Boolean(ok && prints[i] && prints[i+1] && prints[i].payload === prints[i+1].payload);
      const namesEqual = Boolean(ok && prints[i] && prints[i+1] && prints[i].names === prints[i+1].names);
      pairs.push({ samples: [i+1,i+2], payloadEqual, namesEqual, eligible: payloadEqual && namesEqual && samples[i].rows > 0 });
    }
    const eligible = new Set(pairs.filter(p => p.eligible).flatMap(p => p.samples));
    const aggregate = arm => {
      const rows = samples.filter((s,i) => s.arm === arm && eligible.has(i+1));
      return { responseMs: stats(rows.map(s => s.responseMs)), elapsedMs: stats(rows.map(s => s.elapsedMs)) };
    };
    return { complete, scope: 'cold-process-chats50', preflights, samples, pairs,
      comparison: eligible.size ? 'matched-pairs' : 'no-attributable-comparison', eligible: { A: aggregate('A'), B: aggregate('B') } };
  } finally { key.fill(0); prints.length = 0; }
}

async function main() {
  let report;
  try {
    const [root, pathA, digestA, pathB, digestB, ...extra] = process.argv.slice(2);
    if (extra.length || ![digestA,digestB].every(s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)) || process.platform !== 'darwin' || (!process.env.SSH_CONNECTION && !process.env.SSH_CLIENT)) throw new Error();
    const artifacts = { A: { path: pathA, digest: digestA }, B: { path: pathB, digest: digestB } };
    const verified = {};
    report = await compare(async (arm, limit, observe) => {
      try {
        const a = artifacts[arm];
        const binary = await verifyArtifact(root, a.path, a.digest);
        verified[arm] = a.digest;
        return await probe(() => spawn(binary, ['rpc'], { shell: false, stdio: ['pipe','pipe','pipe'] }), { limit, observe });
      } catch { return { outcome: 'precondition', closed: true }; }
    });
    report.verifiedArtifacts = verified;
  } catch { report = { complete: false, outcome: 'precondition' }; }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await main();
