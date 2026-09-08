// Manual, explicit deployment probe. No keys, cookies, IDs or bodies leave memory.
import { request } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OwnerStore } from '../dist/server/owner-store.js';
import { adminCommand } from '../dist/server/admin.js';
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = value => { if (!value) throw new Error(); };
let phase = 'configuration';
async function main() {
  check(process.env.IMSG_WEB_LIVE_PROBE === 'readonly-approved');
  const store = new OwnerStore(process.env.IMSG_WEB_STATE_DIR);
  const mode = process.argv[2];
  if (mode === 'setup') { await store.setup(); process.stdout.write('Private owner hash initialized; key discarded.\n'); return; }
  check(['verify', 'performance'].includes(mode));
  const origin = process.env.IMSG_WEB_ORIGIN, port = Number(process.env.IMSG_WEB_PORT);
  check(new URL(origin).origin === origin && origin.startsWith('https://') && Number.isInteger(port));
  const call = (path, cookie, method = 'GET', data, extra = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: new URL(origin).host, origin, ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...extra } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', b => { bytes += b.length; if (bytes > 4 * 1024 * 1024) req.destroy(new Error()); else chunks.push(b); });
      res.on('error', reject); res.on('end', () => { try { resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0]?.split(';')[0], data: JSON.parse(Buffer.concat(chunks).toString()) }); } catch { reject(new Error()); } });
    });
    req.setTimeout(15_000, () => req.destroy(new Error())); req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
  check((await call('/api/chats')).status === 401);
  const { key } = await adminCommand(store, 'rotate');
  const login = await call('/api/session', undefined, 'POST', { key }); check(login.status === 200 && login.cookie);
  const cookie = login.cookie;
  try {
    phase = 'http-boundaries';
    check((await call('/api/chats', cookie, 'GET', undefined, { origin: 'https://wrong.invalid' })).status === 403);
    for (const path of ['/api/send', '/api/read', '/api/typing', '/api/edit', '/api/rpc']) check((await call(path, cookie, 'POST', {}, { 'x-csrf-token': login.data.csrfToken })).status === 404);
    let selectedId;
    const cycle = async () => {
      const began = performance.now();
      phase = 'capabilities';
      const caps = await call('/api/capabilities', cookie); check(caps.status === 200 && caps.data.mode === 'readonly');
      phase = 'chats';
      const chats = await call('/api/chats?limit=50', cookie); check(chats.status === 200 && Array.isArray(chats.data.chats));
      let messages = null;
      if (chats.data.chats.length) {
        selectedId ??= chats.data.chats[0].id;
        phase = 'history';
        const history = await call(`/api/chats/${selectedId}/messages?limit=50`, cookie);
        check(history.status === 200 && history.data.epoch === chats.data.epoch && Array.isArray(history.data.messages));
        messages = history.data.messages.length;
      }
      return { elapsedMs: Math.round(performance.now() - began), chats: chats.data.chats.length, messages, read: caps.data.features.read.state, typing: caps.data.features.typing.state };
    };
    const cold = await cycle();
    if (mode === 'verify') { process.stdout.write(JSON.stringify({ ok: true, mode, ...cold, mutationRoutesRejected: true }) + '\n'); return; }
    const duration = Number(process.env.IMSG_WEB_PROBE_SECONDS ?? '1800');
    const appPid = Number(process.env.IMSG_WEB_PROBE_PID);
    check(Number.isInteger(duration) && duration >= 300 && duration <= 1800 && Number.isInteger(appPid) && appPid > 1);
    const samples = [], rss = [], pids = new Set(); const began = performance.now();
    let nextCycle = 0, nextReport = 60;
    const memory = async elapsed => {
      phase = 'memory-sampling';
      const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { maxBuffer: 2 * 1024 * 1024 });
      const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      check(rows.some(r => r[0] === appPid));
      const owned = new Set([appPid]); let changed = true;
      while (changed) { changed = false; for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true; } }
      let kb = 0; for (const [pid, , value] of rows) if (owned.has(pid)) { kb += value; pids.add(pid); }
      rss.push({ elapsed, mib: kb / 1024 });
    };
    while ((performance.now() - began) / 1000 < duration) {
      const elapsed = (performance.now() - began) / 1000;
      if (elapsed >= nextCycle) { const result = await cycle(); if (samples.length < 20) samples.push(result.elapsedMs); nextCycle = elapsed + 15; }
      await memory(elapsed);
      if (elapsed >= nextReport) { process.stdout.write(JSON.stringify({ progressSeconds: Math.round(elapsed), samples: samples.length, rssMiB: Math.round(rss.at(-1).mib) }) + '\n'); nextReport += 60; }
      await sleep(5000);
    }
    const median = values => { const sorted = values.sort((a,b) => a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
    const first = median(rss.filter(r => r.elapsed >= 300 && r.elapsed < 900).map(r => r.mib));
    const last = median(rss.filter(r => r.elapsed >= 1200).map(r => r.mib));
    const p95 = [...samples].sort((a,b) => a-b)[18];
    const peak = Math.max(...rss.map(r => r.mib));
    const growth = first !== null && last !== null ? last > first * 1.2 && last - first > 32 : null;
    process.stdout.write(JSON.stringify({ ok: true, mode, cold, samples: samples.length, p95Ms: p95, peakRssMiB: Math.round(peak), firstMedianMiB: first, lastMedianMiB: last, growthFlag: growth, observedProcessIds: pids.size, durationSeconds: duration, withinGuidance: samples.length === 20 && p95 <= 3000 && cold.elapsedMs <= 10000 && peak <= 512 && growth !== true }) + '\n');
  } finally {
    const previousPhase = phase; phase = 'session-revocation';
    await adminCommand(store, 'revoke');
    check((await call('/api/session', cookie)).status === 401);
    process.stdout.write('Probe sessions revoked.\n');
    phase = previousPhase;
  }
}
main().catch(() => { process.stderr.write(`Agent probe failed at ${phase}; details redacted.\n`); process.exitCode = 1; });
