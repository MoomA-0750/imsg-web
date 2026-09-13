// Step3 rung J1 — does the candidate patch actually make anything faster?
//
// The patch exists to speed up contact resolution in chats.list and
// messages.history. Parity says it returns the same answers. Nobody has ever
// measured whether it returns them sooner. This asks that at the RPC level,
// which is cheap, before the full C06 harness is built through the application.
//
// Measurement decisions, each made because the alternative would be wrong:
//
//   * One request in flight at a time. The server answers concurrently and out
//     of order, so overlapping requests cannot be attributed to a duration.
//     Responses are still matched by id, never by arrival.
//   * Cold and warm are reported separately. The first call in a process pays
//     for catalog loading; averaging it in hides the thing being measured.
//   * Arms are interleaved A B B A, repeated. A laptop's clock speed drifts
//     with heat and background work, and running all of one arm then all of the
//     other would put that drift entirely into the comparison.
//   * Every cycle asks exactly the same questions, fixed by one preflight, so
//     neither arm chooses its own workload.
//
// Prints timings and counts. No message text, handle, sender or contact name is
// read out of any response.

import { spawn } from 'node:child_process';

const [baseline, candidate, realDb, tmpdir, home, cyclesRaw, chatLimitRaw, historyLimitRaw, historyChatsRaw] =
  process.argv.slice(2);
if (!baseline || !candidate || !realDb || !tmpdir || !home) {
  console.log('usage: step3-timing.mjs <baseline> <candidate> <realdb> <tmpdir> <home> [cycles] [chatLimit] [historyLimit] [historyChats]');
  process.exit(64);
}
const cycles = Number(cyclesRaw ?? 6);
const chatLimit = Number(chatLimitRaw ?? 25);
const historyLimit = Number(historyLimitRaw ?? 25);
const historyChats = Number(historyChatsRaw ?? 5);

function open(product) {
  const child = spawn(product, ['rpc', '--db', realDb, '--contacts-from-address-book'], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: tmpdir,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    cwd: tmpdir,
  });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (c) => {
    buffer += c;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim().startsWith('{')) continue;
      const r = JSON.parse(line);
      const p = pending.get(r.id);
      if (!p) continue;
      pending.delete(r.id);
      p(r);
    }
  });
  child.stderr.resume();
  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = `t-${seq += 1}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout on ${method}`)); }, 120_000);
    const started = process.hrtime.bigint();
    pending.set(id, (r) => {
      clearTimeout(timer);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, records: (r.result?.chats ?? r.result?.messages ?? []).length, error: r.error?.code });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { call, close: () => new Promise((r) => { child.on('close', r); child.stdin.end(); }) };
}

const quantile = (xs, q) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a');

function report(label, xs) {
  console.log(`  ${label}: n=${xs.length} median=${fmt(quantile(xs, 0.5))}ms p95=${fmt(quantile(xs, 0.95))}ms min=${fmt(Math.min(...xs))} max=${fmt(Math.max(...xs))}`);
}

const main = async () => {
  console.log('== step3 timing begin');
  console.log(`date: ${new Date().toISOString()}`);
  console.log(`cycles per arm: ${cycles}, chats=${chatLimit}, history=${historyLimit} over ${historyChats} chats`);

  // One preflight read to fix the workload. call() deliberately returns counts
  // rather than rows, so the ids are taken here, once, and then never again.
  const chatIds = [];
  const idProbe = spawn(baseline, ['rpc', '--db', realDb, '--contacts-from-address-book'], {
    shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: tmpdir, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    cwd: tmpdir,
  });
  const idsText = await new Promise((resolve) => {
    let out = '';
    idProbe.stdout.on('data', (c) => { out += c; });
    idProbe.stderr.resume();
    idProbe.on('close', () => resolve(out));
    idProbe.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'ids', method: 'chats.list', params: { limit: chatLimit } })}\n`);
    idProbe.stdin.end();
  });
  for (const line of idsText.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    for (const c of JSON.parse(line).result?.chats ?? []) chatIds.push(c.id);
  }
  if (chatIds.length === 0) { console.log('no chats; nothing to time'); process.exit(70); }
  const workload = chatIds.slice(0, historyChats);
  console.log(`workload: chats.list(${chatLimit}) + ${workload.length} x messages.history(${historyLimit})`);

  const samples = {
    baseline: { cold: [], chats: [], history: [], cycle: [] },
    candidate: { cold: [], chats: [], history: [], cycle: [] },
  };

  async function runCycles(arm, product) {
    const s = open(product);
    let cold = true;
    for (let i = 0; i < cycles; i += 1) {
      const t0 = process.hrtime.bigint();
      const c = await s.call('chats.list', { limit: chatLimit });
      if (c.error) throw new Error(`chats.list error ${c.error}`);
      const hs = [];
      for (const id of workload) {
        const h = await s.call('messages.history', { chat_id: id, limit: historyLimit });
        if (h.error) throw new Error(`messages.history error ${h.error}`);
        hs.push(h.ms);
      }
      const cycleMs = Number(process.hrtime.bigint() - t0) / 1e6;
      if (cold) {
        samples[arm].cold.push(cycleMs);
        cold = false;
      } else {
        samples[arm].chats.push(c.ms);
        samples[arm].history.push(...hs);
        samples[arm].cycle.push(cycleMs);
      }
    }
    await s.close();
  }

  // A B B A, repeated. Each repetition is one full pass of each arm.
  console.log('== interleaved passes');
  for (let pass = 0; pass < 2; pass += 1) {
    for (const arm of pass % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
      const t = Date.now();
      await runCycles(arm, arm === 'baseline' ? baseline : candidate);
      console.log(`  pass ${pass + 1} ${arm}: ${Date.now() - t}ms wall`);
    }
  }

  for (const arm of ['baseline', 'candidate']) {
    console.log(`== ${arm}`);
    report('cold cycle (first in each process)', samples[arm].cold);
    report('warm chats.list', samples[arm].chats);
    report('warm messages.history', samples[arm].history);
    report('warm full cycle', samples[arm].cycle);
  }

  const b = quantile(samples.baseline.cycle, 0.5);
  const c = quantile(samples.candidate.cycle, 0.5);
  console.log('== comparison (warm full cycle, median)');
  console.log(`  baseline ${fmt(b)}ms vs candidate ${fmt(c)}ms`);
  console.log(`  candidate is ${fmt(((b - c) / b) * 100)}% faster (negative means slower)`);
  console.log('== step3 timing end');
};

main().catch((e) => { console.log(`fatal: ${e.message}`); process.exit(1); });
