// Explicit, bounded foreground diagnostic. No payloads, IDs or credentials logged.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, isAbsolute, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const check = v => { if (!v) throw new Error(); };
let signal;
const sleep = ms => delay(ms, undefined, { signal });
const round = n => Math.round(n * 10) / 10;
export async function measured(events, stage, operation) {
  check(['status', 'chats.list', 'messages.history', 'cli.status', 'reader.close'].includes(stage));
  const start = performance.now(); let ok = false;
  try { const value = await operation(); ok = true; return value; }
  finally { events.push({ stage, ms: round(performance.now() - start), ok }); }
}
export function summary(samples) {
  check(samples.length > 0 && samples.every(n => Number.isFinite(n) && n >= 0));
  const sorted = [...samples].sort((a,b) => a-b);
  return { count: sorted.length, minMs: sorted[0], maxMs: sorted.at(-1) };
}
export async function cleanup({ revoke, close, verify }, emit) {
  const result = { revocationVerified: false, shutdownVerified: false, stateVerified: false };
  try { await revoke(); result.revocationVerified = true; } catch {}
  try { await close(); result.shutdownVerified = true; } catch {}
  try { await verify(); result.stateVerified = true; } catch {}
  const confirmed = Object.values(result).every(Boolean);
  emit({ cleanup: confirmed ? 'confirmed' : 'unconfirmed', ...result });
  check(confirmed);
}
async function safeTree(path, admin = false) {
  for (let p = path; ; p = dirname(p)) {
    const s = await lstat(p), stickyRoot = s.isDirectory() && s.uid === 0 && Boolean(s.mode & 0o1000);
    const trustedAdmin = admin && s.isDirectory() && s.gid === 80 && !(s.mode & 0o002);
    check(!s.isSymbolicLink() && [0, process.getuid()].includes(s.uid) && (!(s.mode & 0o022) || stickyRoot || trustedAdmin));
    if (p === dirname(p)) break;
  }
}
function call(port, path, cookie, data) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, signal, method: data ? 'POST' : 'GET', headers: { host: 'diagnostic.invalid', origin: 'https://diagnostic.invalid', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}) } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', b => { bytes += b.length; if (bytes > 4 * 1024 * 1024) req.destroy(new Error()); else chunks.push(b); });
      res.on('error', reject); res.on('end', () => { try { resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0]?.split(';')[0], data: JSON.parse(Buffer.concat(chunks).toString()) }); } catch { reject(new Error()); } });
    });
    const deadline = setTimeout(() => req.destroy(new Error()), 15000);
    req.once('close', () => clearTimeout(deadline)); req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
}
async function main() {
  check(process.env.IMSG_WEB_DIAGNOSTIC === 'readonly-approved' && process.platform === 'darwin' && process.versions.node === '24.20.0');
  const context = process.argv[2] ?? 'foreground';
  check(['foreground', 'agent-standard', 'agent-interactive'].includes(context));
  const base = process.env.IMSG_WEB_BASE, release = process.env.IMSG_WEB_RELEASE, executable = process.env.IMSG_WEB_IMSG_PATH;
  check([base, release, executable].every(p => typeof p === 'string' && isAbsolute(p)));
  check(release === join(base, 'releases', 'a342425'));
  check(executable === (process.arch === 'arm64' ? '/opt/homebrew/bin/imsg' : '/usr/local/bin/imsg'));
  const bs = await lstat(base); check(bs.isDirectory() && !bs.isSymbolicLink() && bs.uid === process.getuid() && (bs.mode & 0o777) === 0o700);
  await safeTree(base); await safeTree(release); await safeTree(process.execPath);
  await safeTree(await realpath(executable), true); await safeTree(dirname(executable), true);
  // All transitive source/dependency files were installed from the pinned artifact;
  // reject substituted symlinks/writable files inside that existing release.
  async function checkFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), s = await lstat(path);
      check(!s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o022));
      if (s.isDirectory()) await checkFiles(path); else check(s.isFile());
    }
  }
  // npm's .bin links are executable conveniences, not imported by this script.
  await checkFiles(join(release, 'dist'));
  const mod = name => import(pathToFileURL(join(release, 'dist/server', name + '.js')).href);
  const [{ LiveSource }, { ReadonlyRpcClient }, { cliStatus }, { OwnerStore }, { startRuntime }, { adminCommand }] = await Promise.all(['live-source', 'rpc/readonly-client', 'cli-status', 'owner-store', 'runtime', 'admin'].map(mod));
  const events = [], clients = [];
  const source = new LiveSource({ executable, factory: () => {
    const c = new ReadonlyRpcClient({ executable }); clients.push(c);
    return { get closed() { return c.closed; }, request: (method, params) => measured(events, method, () => c.request(method, params)), close: () => measured(events, 'reader.close', () => c.close()) };
  }, getCli: () => measured(events, 'cli.status', () => cliStatus(executable)) });
  const state = join(base, 'd-' + randomBytes(4).toString('hex'));
  const store = new OwnerStore(state); const key = await store.setup();
  let runtime, cookie, port, success = false;
  const abort = new AbortController(); signal = abort.signal;
  const interrupt = () => abort.abort();
  process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
  const deadline = setTimeout(interrupt, 180000);
  try {
    runtime = await startRuntime({ store, source, origin: 'https://diagnostic.invalid', port: 0 });
    port = runtime.app.server.address().port;
    check((await call(port, '/api/chats')).status === 401);
    const login = await call(port, '/api/session', undefined, { key }); check(login.status === 200 && login.cookie); cookie = login.cookie;
    let id, epoch; const withCli = [], withoutCli = []; const began = performance.now(), cpuBegan = process.cpuUsage();
    let nextStart = began;
    for (let index = 0; index <= 6; index++) {
      await sleep(Math.max(0, nextStart - performance.now()));
      events.length = 0; const start = performance.now(), endpoints = {};
      let at = performance.now(); const caps = await call(port, '/api/capabilities', cookie); endpoints.capabilitiesMs = round(performance.now() - at); check(caps.status === 200 && caps.data.mode === 'readonly');
      at = performance.now(); const chats = await call(port, '/api/chats?limit=50', cookie); endpoints.chatsMs = round(performance.now() - at); check(chats.status === 200 && Array.isArray(chats.data.chats));
      id ??= chats.data.chats[0]?.id; epoch ??= chats.data.epoch; check(chats.data.epoch === epoch);
      let messages = null;
      if (id) {
        at = performance.now(); const history = await call(port, `/api/chats/${id}/messages?limit=50`, cookie); endpoints.historyMs = round(performance.now() - at); check(history.status === 200 && history.data.epoch === epoch); messages = history.data.messages.length;
      }
      const cycleMs = round(performance.now() - start), cliRefresh = events.some(e => e.stage === 'cli.status'); if (index) (cliRefresh ? withCli : withoutCli).push(cycleMs);
      process.stdout.write(JSON.stringify({ index, firstInFreshRuntime: index === 0, startOffsetMs: round(start - began), cycleMs, cliRefresh, ...endpoints, chats: chats.data.chats.length, messages, read: caps.data.features.read.state, typing: caps.data.features.typing.state, events: [...events] }) + '\n');
      nextStart += 15000;
      while (nextStart < performance.now()) nextStart += 15000;
    }
    const cpu = process.cpuUsage(cpuBegan);
    process.stdout.write(JSON.stringify({ mode: 'stage-diagnostic', context, workload: 'each-host-first-chat-not-cross-host-matched', withCli: withCli.length ? summary(withCli) : null, withoutCli: withoutCli.length ? summary(withoutCli) : null, actualElapsedMs: round(performance.now() - began), parentCpuUserMs: round(cpu.user / 1000), parentCpuSystemMs: round(cpu.system / 1000), parentRssMiB: round(process.memoryUsage().rss / 1048576), childCpuAndEnergyAssessed: false, gateMeasurement: false }) + '\n');
    success = true;
  } finally {
    clearTimeout(deadline); process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt); signal = undefined;
    await cleanup({
      revoke: async () => { if (runtime) { check((await adminCommand(store, 'revoke')).ok === true); if (cookie) check((await call(port, '/api/session', cookie)).status === 401); } },
      close: async () => { if (runtime) await runtime.close(); else await source.close(); check(clients.every(c => c.closed)); },
      verify: async () => { check((await readdir(state)).join(',') === 'owner.json'); },
    }, result => process.stdout.write(JSON.stringify({ ...result, pid: process.pid, port, privateState: state.split('/').at(-1), completed: success }) + '\n'));
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('Diagnostic failed; details redacted. Preserve state and confirm shutdown.\n'); process.exitCode = 1; });
