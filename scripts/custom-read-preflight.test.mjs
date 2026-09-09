import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile, realpath, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { probe, request, verifyArtifact } from './custom-read-preflight.mjs';

const valid = JSON.stringify({ jsonrpc: '2.0', id: 'preflight', result: { chats: [{ id: 1, contact_name: 'SECRET' }] } }) + '\n';
const options = { timeoutMs: 1000, graceMs: 50, killWaitMs: 1000 };
async function fixture(body, opts = {}) {
  let child;
  const got = await probe(() => {
    child = spawn(process.execPath, ['-e', `process.stdin.resume(); ${body}`], { stdio: 'pipe' });
    return child;
  }, { ...options, ...opts });
  assert.equal(got.closed, true);
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
  assert.ok(!JSON.stringify(got).includes('SECRET'));
  return got;
}

test('P2 fixed request; fragmented valid response; graceful close', async () => {
  const got = await fixture(`let input = ''; let responded = false;
  process.stdin.on('end', () => { if (input !== ${JSON.stringify(JSON.stringify(request) + '\n')}) process.exitCode = 9; });
  process.stdin.on('data', b => {
    input += b; if (responded || !input.includes('\\n')) return; responded = true;
    process.stdout.write(${JSON.stringify(valid.slice(0, 15))});
    setTimeout(() => process.stdout.write(${JSON.stringify(valid.slice(15))}), 5);
  });`);
  assert.equal(got.outcome, 'ok'); assert.equal(got.rows, 1); assert.equal(got.namedRows, 1);
  assert.equal(got.sentTerm, false);
});

test('P3 terminal failures cannot follow provisional success', async t => {
  for (const [label, suffix] of [
    ['stderr', `process.stderr.write('SECRET');`],
    ['duplicate', `process.stdout.write(${JSON.stringify(valid)});`],
    ['trailing', `process.stdout.write('SECRET');`],
    ['exit', 'process.exitCode = 2;'],
  ]) await t.test(label, async () => {
    const got = await fixture(`process.stdin.once('data', () => {
      process.stdout.write(${JSON.stringify(valid)});
      process.stdin.once('end', () => { ${suffix} });
    });`);
    assert.equal(got.outcome, label === 'stderr' ? 'stderr' : label === 'exit' ? 'exit' : 'protocol');
  });
});

test('P3 malformed envelopes and framing fail', async t => {
  for (const payload of ['SECRET\n', valid.replace('preflight', 'wrong'), valid + valid,
    valid.replace('"result":', '"error":{},"result":'),
    valid.replace('[{"id":1,"contact_name":"SECRET"}]', '[null]'), '\n', valid.trimEnd()]) {
    await t.test('invalid', async () => {
      const got = await fixture(`process.stdin.once('data', () => { process.stdout.write(${JSON.stringify(payload)}); process.exitCode = 0; process.stdin.pause(); });`);
      assert.equal(got.outcome, payload === valid.trimEnd() ? 'timeout' : 'protocol');
    });
  }
});

test('P3 oversized stdout, timeout, early exit, spawn failure', async () => {
  assert.equal((await fixture(`process.stdout.write('x'.repeat(1024 * 1024 + 1));`)).outcome, 'oversize');
  assert.equal((await fixture('setInterval(() => {}, 1000);')).outcome, 'timeout');
  assert.notEqual((await fixture('process.exit(0);')).outcome, 'ok');
  const got = await probe(() => spawn('/nonexistent-imsg-preflight', [], { stdio: 'pipe' }), options);
  assert.equal(got.closed, true); assert.equal(got.outcome, 'spawn');
});

test('P4 EOF/TERM-resistant child requires KILL', async () => {
  const got = await fixture(`process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`, { timeoutMs: 200 });
  assert.equal(got.sentTerm, true); assert.equal(got.sentKill, true); assert.equal(got.signal, 'SIGKILL');
  assert.ok(got.elapsedMs < 2000);
});

test('P4 repeated interruption during cleanup settles once', async () => {
  const signals = new EventEmitter();
  const timer = setInterval(() => signals.emit('SIGHUP'), 50);
  try {
    const got = await fixture(`process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`, { signals });
    assert.equal(got.outcome, 'interrupted'); assert.equal(signals.listenerCount('SIGHUP'), 0);
  } finally { clearInterval(timer); }
});

test('P1 digest and containment fail before any caller can spawn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'imsg-preflight-test-'));
  const binary = join(root, 'binary'); await writeFile(binary, 'fixture', { mode: 0o700 });
  const digest = createHash('sha256').update('fixture').digest('hex');
  assert.equal(await verifyArtifact(root, binary, digest), await realpath(binary));
  await assert.rejects(verifyArtifact(root, binary, '0'.repeat(64)));
  await chmod(binary, 0o722); await assert.rejects(verifyArtifact(root, binary, digest));
  await chmod(binary, 0o700);
  const outside = await mkdtemp(join(tmpdir(), 'imsg-preflight-outside-'));
  await writeFile(join(outside, 'binary'), 'fixture', { mode: 0o700 });
  await symlink(join(outside, 'binary'), join(root, 'escape'));
  await assert.rejects(verifyArtifact(root, join(root, 'escape'), digest));
  await chmod(root, 0o755); await assert.rejects(verifyArtifact(root, binary, digest)); await chmod(root, 0o700);
  await chmod(binary, 0o600); await assert.rejects(verifyArtifact(root, binary, digest));
  await assert.rejects(verifyArtifact(root, root, digest));
  await assert.rejects(verifyArtifact(root, 'relative', digest));
});

test('P4 close timeout releases parent handles and reports uncertainty', { timeout: 5000 }, async () => {
  const moduleURL = new URL('./custom-read-preflight.mjs', import.meta.url).href;
  // A bounded descendant keeps inherited pipes open after the direct child exits.
  const body = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], {stdio:['ignore',1,2]}).unref();`;
  const script = `import {probe} from ${JSON.stringify(moduleURL)}; import {spawn} from 'node:child_process';
    console.log(JSON.stringify(await probe(() => spawn(process.execPath,['-e',${JSON.stringify(body)}],{stdio:'pipe'}),
      {timeoutMs:1000,graceMs:30,killWaitMs:100})));`;
  const parent = spawn(process.execPath, ['--input-type=module','-e',script], {stdio:'pipe'});
  let stdout = ''; parent.stdout.on('data', b => { stdout += b; }); parent.stderr.resume();
  const deadline = setTimeout(() => parent.kill('SIGKILL'), 2500);
  try {
    const [code, signal] = await new Promise(resolve => parent.once('close', (...args) => resolve(args)));
    assert.equal(code, 0); assert.equal(signal, null);
    const got = JSON.parse(stdout); assert.equal(got.outcome, 'cleanup'); assert.equal(got.closed, false);
  } finally { clearTimeout(deadline); }
});

test('P3 raw harness output never contains response/error markers', async () => {
  const moduleURL = new URL('./custom-read-preflight.mjs', import.meta.url).href;
  for (const body of [
    `process.stdout.write(${JSON.stringify(valid)});`,
    `process.stdout.write('SECRET invalid\\n');`,
    `process.stderr.write('SECRET error');`,
  ]) {
    const script = `import { probe } from ${JSON.stringify(moduleURL)};
      import { spawn } from 'node:child_process';
      const result = await probe(() => spawn(process.execPath, ['-e', ${JSON.stringify(`process.stdin.resume(); process.stdin.once('data', () => { ${body} });`)}], {stdio:'pipe'}), {timeoutMs:500});
      console.log(JSON.stringify(result));`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' });
    let stdout = '', stderr = '';
    parent.stdout.on('data', b => { stdout += b; }); parent.stderr.on('data', b => { stderr += b; });
    const code = await new Promise(resolve => parent.once('close', resolve));
    assert.equal(code, 0); assert.equal(stderr, '');
    assert.ok(!stdout.includes('SECRET'));
    assert.equal(stdout.trim().split('\n').length, 1);
    const summary = JSON.parse(stdout);
    assert.ok(Object.keys(summary).every(k => ['outcome','closed','exitCode','signal','sentTerm','sentKill','elapsedMs','responseMs','rows','namedRows'].includes(k)));
  }
});

test('P4 cooperative child gets EOF when parent is killed', { timeout: 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'imsg-parent-loss-'));
  const marker = join(root, 'eof');
  const moduleURL = new URL('./custom-read-preflight.mjs', import.meta.url).href;
  const body = `process.stdin.resume(); process.stdin.on('end', () => {
    require('fs').writeFileSync(${JSON.stringify(marker)}, 'eof'); process.disconnect();
  }); process.send('ready');`;
  const script = `import { probe } from ${JSON.stringify(moduleURL)}; import {spawn} from 'node:child_process';
    await probe(() => { const c = spawn(process.execPath, ['-e', ${JSON.stringify(body)}], {stdio:['pipe','pipe','pipe','ipc']});
      c.on('message', () => process.send('ready')); return c; });`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe','pipe','pipe','ipc'] });
  const closed = new Promise(resolve => parent.once('close', resolve));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('parent readiness')), 2000);
      parent.once('message', () => { clearTimeout(timer); resolve(); });
    });
    parent.kill('SIGKILL'); await closed;
    let observed = false;
    for (let i = 0; i < 30; i++) {
      try { observed = (await readFile(marker, 'utf8')) === 'eof'; } catch {}
      if (observed) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(observed, true);
  } finally { parent.kill('SIGKILL'); await closed; }
});

test('CLI via symlink emits one precondition summary with no missing entrypoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'imsg-cli-link-'));
  const link = join(root, 'runner.mjs');
  await symlink(new URL('./custom-read-preflight.mjs', import.meta.url), link);
  const child = spawn(process.execPath, [link], {stdio:'pipe'});
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1); assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), {outcome:'precondition', closed:true});
});
