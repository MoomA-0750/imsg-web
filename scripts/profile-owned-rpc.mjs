// Short stack sampling of a verified readonly child created by this process.
// Numeric-PID attachment has a residual race; abort on exit and verify identity.
// Raw reports remain in a private Mac directory; stdout has fixed categories only.
import childProcess, { execFile, spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const run = promisify(execFile), check = v => { if (!v) throw new Error(); };
let phase = 'configuration';
const groups = {
  contactsAuthorization: /CNContactStore.*authorizationStatus|TCCAccessRequest|TCCAccessPreflight|__TCC/,
  contactsFramework: /\(in Contacts\)/,
  sqlite: /sqlite3_|\(in libsqlite3/,
  messageMetadata: /MessageStore|chatInfo|participants|buildMessagePayload/,
  preferences: /CFPreferences|cfprefsd/,
  ipcWait: /mach_msg|xpc_connection_send_message_with_reply_sync|__ulock_wait|semaphore_wait/,
};
// This isolated diagnostic wraps exactly one synchronous constructor call,
// restores the builtin before any asynchronous work, and retains the OS handle.
export async function captureChild(factory, executable) {
  const original = childProcess.spawn; let owned, client, failed = false;
  childProcess.spawn = (...args) => {
    check(!owned && args[0] === executable && JSON.stringify(args[1]) === '["rpc"]' && args[2]?.shell === false);
    owned = original(...args); return owned;
  };
  syncBuiltinESMExports();
  try { client = factory(); check(owned); }
  catch { failed = true; }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  if (failed) {
    if (owned) {
      let closed = false; const exited = new Promise(resolve => owned.once('close', () => { closed = true; resolve(); }));
      owned.stdout?.resume(); owned.stderr?.resume(); owned.once('error', () => {});
      const wait = async () => { let timer; try { await Promise.race([exited, new Promise(r => { timer = setTimeout(r, 1000); })]); } finally { clearTimeout(timer); } };
      owned.stdin?.end(); await wait();
      if (!closed) { owned.kill('SIGTERM'); await wait(); }
      if (!closed) { owned.kill('SIGKILL'); await wait(); }
      if (!closed) { owned.stdin?.destroy(); owned.stdout?.destroy(); owned.stderr?.destroy(); owned.unref(); }
      check(closed);
    }
    throw new Error();
  }
  return { client, child: owned };
}
function callGraph(raw) {
  return raw.split(/\r?\nCall graph:\r?\n/)[1]?.split(/\r?\n\S/)[0] ?? '';
}
export function validateReport(raw, pid, parent, stage) {
  check(new RegExp(`^Process:\\s+imsg \\[${pid}\\]\\s*$`, 'm').test(raw));
  check(new RegExp(`^Parent Process:\\s+node \\[${parent}\\]\\s*$`, 'm').test(raw));
  const graph = callGraph(raw);
  check(graph && /^\s+[1-9]\d*\s+Thread_/m.test(graph));
  // A handler stack is direct evidence that the requested phase was sampled.
  const frames = graph.split('\n').map(l => l.match(/^\s*[+|:! ]*\s*([1-9]\d*)\s+(.+)$/)).filter(Boolean);
  const overlapVerified = stage === 'idle' ? null : frames.some(m => (stage === 'chats' ? /handleChatsList/ : /handleMessagesHistory/).test(m[2]) && /\(in imsg\)/.test(m[2]));
  return { targetVerified: true, structureVerified: true, overlapVerified };
}
function sampler(pid, path, target) {
  check(target.pid === pid && target.exitCode === null && target.signalCode === null);
  const child = spawn('/usr/bin/sample', [String(pid), '1', '1', '-file', path], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false, invalid = false, total = 0;
  const kill = () => { invalid = true; child.kill('SIGKILL'); };
  target.once('exit', kill);
  const deadline = setTimeout(kill, 20000);
  const done = new Promise(resolve => {
    const hard = setTimeout(() => {
      kill(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      resolve(false); // Missing close acknowledgement is explicitly failure.
    }, 24000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', b => { total += b.length; if (total > 1024 * 1024) kill(); });
      stream.on('error', kill);
    }
    child.once('error', kill);
    child.once('close', code => { closed = true; clearTimeout(hard); resolve(code === 0 && !invalid); });
  }).finally(() => { clearTimeout(deadline); target.removeListener('exit', kill); });
  return { child, done, get closed() { return closed; } };
}
export function summarize(raw) {
  const result = Object.fromEntries(Object.keys(groups).map(k => [k, { seen: false, maxInclusiveStackCount: 0 }]));
  for (const line of callGraph(raw).split('\n')) {
    const match = line.match(/^\s*[+|:! ]*\s*([1-9]\d*)\s+(.+)$/); if (!match) continue;
    for (const [name, pattern] of Object.entries(groups)) if (pattern.test(match[2])) {
      result[name].seen = true; result[name].maxInclusiveStackCount = Math.max(result[name].maxInclusiveStackCount, Number(match[1]));
    }
  }
  return result;
}
async function safe(path, admin = false) {
  for (let p = path; ; p = dirname(p)) {
    const s = await lstat(p), sticky = s.isDirectory() && s.uid === 0 && Boolean(s.mode & 0o1000);
    check(!s.isSymbolicLink() && [0, process.getuid()].includes(s.uid) && (!(s.mode & 0o022) || sticky || (admin && s.isDirectory() && s.gid === 80 && !(s.mode & 0o002))));
    if (p === dirname(p)) break;
  }
}
async function main() {
  check(process.platform === 'darwin' && process.versions.node === '24.20.0' && process.env.IMSG_WEB_PROFILE === 'owned-readonly-approved');
  const base = process.env.IMSG_WEB_BASE, directory = process.env.IMSG_WEB_PROFILE_DIR;
  const executable = process.arch === 'arm64' ? '/opt/homebrew/bin/imsg' : '/usr/local/bin/imsg';
  check([base, directory].every(p => typeof p === 'string' && isAbsolute(p)));
  // /tmp itself resolves to /private/tmp on macOS; validate the canonical tree.
  const output = await realpath(directory); await safe(output);
  const s = await lstat(output); check(s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
  await safe(base); await safe(process.execPath); const canonical = await realpath(executable); await safe(canonical, true);
  // Homebrew's known shell wrapper execs the same-version libexec image.
  const imageExecutable = join(dirname(dirname(canonical)), 'libexec/imsg');
  check(canonical.endsWith(process.arch === 'arm64' ? '/Cellar/imsg/0.15.1/bin/imsg' : '/Cellar/imsg/0.14.2/bin/imsg'));
  check((await lstat(canonical)).size < 4096);
  check(await readFile(canonical, 'utf8') === `#!/bin/bash\nexec "${imageExecutable}" "$@"\n`);
  await safe(imageExecutable, true);
  const release = join(base, 'releases/a342425'); await safe(release);
  const clientPath = join(release, 'dist/server/rpc/readonly-client.js'); await safe(clientPath);
  const { ReadonlyRpcClient } = await import(pathToFileURL(clientPath).href);
  const { client: c, child } = await captureChild(() => new ReadonlyRpcClient({ executable, context: buildChildEnv({ tmpDir: directory, cwd: directory }) }), executable);
  const pid = child.pid; let completed = false, childClosed = false; const samplers = [];
  child.once('close', () => { childClosed = true; });
  process.stdout.write(JSON.stringify({ event: 'owned-child', parentPid: process.pid, childPid: pid ?? null }) + '\n');
  const processRows = async () => {
    const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.trim().split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(m => ({ pid: Number(m[1]), parent: Number(m[2]), executable: m[3] }));
  };
  const startIdentity = async () => {
    const { stdout } = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 1024 });
    check(stdout.trim()); return stdout.trim();
  };
  try {
    phase = 'child-identity';
    check(Number.isSafeInteger(pid) && pid > 1);
    check((await processRows()).some(r => r.pid === pid && r.parent === process.pid && r.executable === imageExecutable));
    const identity = await startIdentity();
    phase = 'bootstrap-read';
    const status = await c.request('status'); check(status.database?.ready === true);
    const chats = await c.request('chats.list', { limit: 50 }); check(Array.isArray(chats.chats));
    const chatId = chats.chats[0]?.id; check(chatId === undefined || (Number.isSafeInteger(chatId) && chatId > 0));
    const windows = ['idle', 'chats', ...(chatId ? ['history'] : [])];
    for (const stage of windows) {
      phase = `${stage}-identity`;
      check(!c.closed && (await processRows()).some(r => r.pid === pid && r.parent === process.pid && r.executable === imageExecutable));
      check(await startIdentity() === identity);
      const path = join(output, `${stage}.sample.txt`);
      const f = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await f.close();
      const began = performance.now();
      phase = `${stage}-sampling`;
      const sampling = sampler(pid, path, child); samplers.push(sampling);
      process.stdout.write(JSON.stringify({ event: 'owned-sampler', samplerPid: sampling.child.pid ?? null }) + '\n');
      let rpcMs = null;
      try {
        if (stage !== 'idle') {
          const at = performance.now();
          await c.request(stage === 'chats' ? 'chats.list' : 'messages.history', stage === 'chats' ? { limit: 50 } : { chat_id: chatId, limit: 50, attachments: false });
          rpcMs = Math.round(performance.now() - at);
        }
      } finally { check(await sampling.done); }
      check(!c.closed && child.exitCode === null && child.signalCode === null && await startIdentity() === identity);
      const info = await lstat(path); check(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size <= 8 * 1024 * 1024);
      phase = `${stage}-report-validation`;
      const raw = await readFile(path, 'utf8');
      const evidence = validateReport(raw, pid, process.pid, stage);
      process.stdout.write(JSON.stringify({ stage, rpcMs, elapsedMs: Math.round(performance.now() - began), ...evidence, categories: summarize(raw), inclusiveCountsNotCpuPercent: true }) + '\n');
      check(stage === 'idle' || evidence.overlapVerified);
    }
    completed = true;
  } finally {
    let closed = false;
    try {
      await c.close(); check(childClosed && samplers.every(s => s.closed));
      const rows = await processRows();
      check(!rows.some(r => (pid !== undefined && r.pid === pid) || (r.parent === process.pid && [executable, canonical, imageExecutable, '/usr/bin/sample'].includes(r.executable))));
      closed = true;
    } finally { process.stdout.write(JSON.stringify({ completed, childStopConfirmed: closed, rawReportsRemainPrivate: true }) + '\n'); }
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write(`Owned RPC profiling failed at ${phase}; do not escalate privileges or continue variants. Preserve private reports and verify child shutdown.\n`); process.exitCode = 1; });
