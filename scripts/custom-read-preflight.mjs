import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const request = Object.freeze({ jsonrpc: '2.0', id: 'preflight', method: 'chats.list', params: { limit: 1 } });
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export async function verifyArtifact(root, executable, digest) {
  if (![root, executable].every(p => typeof p === 'string' && isAbsolute(p)) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('artifact');
  const base = await realpath(root), binary = await realpath(executable);
  const rel = relative(base, binary);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('artifact');
  const top = await lstat(base);
  if (!top.isDirectory() || top.uid !== process.getuid() || (top.mode & 0o777) !== 0o700) throw new Error('artifact');
  for (let p = binary; ; p = dirname(p)) {
    const s = await lstat(p);
    if (s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o022)) throw new Error('artifact');
    if (p === binary ? !s.isFile() || !(s.mode & 0o100) : !s.isDirectory()) throw new Error('artifact');
    if (p === base) break;
  }
  if (createHash('sha256').update(await readFile(binary)).digest('hex') !== digest) throw new Error('artifact');
  return binary;
}

// Test seam takes a factory, never a CLI-controlled command or RPC method.
export function probe(createChild, { timeoutMs = 15000, graceMs = 500, killWaitMs = 2000, signals = process, limit = 1, observe = () => {} } = {}) {
  if (![1, 50].includes(limit)) throw new Error('precondition');
  return new Promise(resolve => {
    const start = performance.now();
    let child, failure, output = Buffer.alloc(0), total = 0, result;
    let stopping = false, settled = false, sentTerm = false, sentKill = false;
    const timers = [], handlers = new Map();
    const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
    const finish = (closed, code = null, signal = null) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      for (const [name, fn] of handlers) signals.off(name, fn);
      if (!closed) {
        failure = 'cleanup';
        // Report uncertainty without keeping this one-shot parent alive forever.
        child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
        child?.unref();
      }
      else if (!failure && (code !== 0 || signal || sentTerm || sentKill)) failure = 'exit';
      else if (!failure && (!result || output.length)) failure = 'protocol';
      resolve({ outcome: failure ?? 'ok', closed, exitCode: code, signal,
        sentTerm, sentKill, elapsedMs: Math.round(performance.now() - start),
        ...(failure ? {} : result) });
    };
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      child?.stdin.end();
      later(() => {
        if (settled) return;
        sentTerm = true; child?.kill('SIGTERM');
        later(() => {
          if (settled) return;
          sentKill = true; child?.kill('SIGKILL');
          later(() => finish(false), killWaitMs);
        }, graceMs);
      }, graceMs);
    };
    const fail = reason => { failure ??= reason; stop(); };
    try { child = createChild(); } catch { failure = 'spawn'; finish(true); return; }
    child.once('error', () => fail('spawn'));
    child.once('close', (code, signal) => finish(true, code, signal));
    child.stdin.on('error', () => fail('stdin'));
    child.stdout.on('error', () => fail('stdout'));
    child.stderr.on('error', () => fail('stderr'));
    child.stderr.on('data', () => fail('stderr'));
    child.stdout.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > 1024 * 1024) { fail('oversize'); return; }
      if (failure) return;
      output = Buffer.concat([output, chunk]);
      let at;
      while ((at = output.indexOf(10)) !== -1) {
        const line = output.subarray(0, at); output = output.subarray(at + 1);
        try {
          const msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (result || !record(msg) || msg.jsonrpc !== '2.0' || msg.id !== request.id ||
              Object.keys(msg).some(k => !['jsonrpc', 'id', 'result'].includes(k)) ||
              !record(msg.result) || !Array.isArray(msg.result.chats) || msg.result.chats.length > limit ||
              !msg.result.chats.every(c => record(c) && Number.isSafeInteger(c.id) && c.id > 0 &&
                (!Object.hasOwn(c, 'contact_name') || typeof c.contact_name === 'string'))) throw new Error();
          result = { responseMs: Math.round(performance.now() - start), rows: msg.result.chats.length, namedRows: msg.result.chats.filter(c => typeof c.contact_name === 'string').length };
          observe(msg.result);
          stop();
        } catch { fail('protocol'); return; }
      }
    });
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const fn = () => fail('interrupted'); handlers.set(name, fn); signals.on(name, fn);
    }
    later(() => fail('timeout'), timeoutMs);
    child.stdin.write(`${JSON.stringify({ ...request, params: { limit } })}\n`);
  });
}

async function main() {
  let summary;
  try {
    const [root, executable, digest, ...extra] = process.argv.slice(2);
    if (extra.length || process.platform !== 'darwin' || (!process.env.SSH_CONNECTION && !process.env.SSH_CLIENT)) throw new Error();
    const binary = await verifyArtifact(root, executable, digest);
    summary = { ...await probe(() => spawn(binary, ['rpc'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })), binarySha256: digest };
  } catch { summary = { outcome: 'precondition', closed: true }; }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = summary.outcome === 'ok' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await main();
