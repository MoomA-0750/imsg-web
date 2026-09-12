import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';

const tracking = vi.hoisted(() => ({ children: [] as { child: ChildProcess; closed: boolean; done: Promise<void> }[], events: [] as string[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    const index = tracking.children.length;
    const record = { child, closed: false, done: Promise.resolve() };
    record.done = new Promise(resolve => child.once('close', () => {
      record.closed = true; tracking.events.push(`close-${index}`); resolve();
    }));
    tracking.children.push(record); tracking.events.push(`spawn-${index}`);
    return child;
  } };
});
import { LiveSource } from '../src/server/live-source.js';
import { ReadonlyRpcClient } from '../src/server/rpc/readonly-client.js';
import { Auth, hashKey } from '../src/server/auth.js';
import { createApp } from '../src/server/http.js';
// @ts-expect-error Experimental standalone JavaScript helper has no declarations.
import { createOwnedReaderGate } from '../scripts/nonlaunch-owned-readers.mjs';
// @ts-expect-error Experimental standalone JavaScript helper has no declarations.
import { runApiSession } from '../scripts/nonlaunch-api-session.mjs';
import { testContext } from './helpers/child-context.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally {
    // Signal only handles created by this test; never discover or kill by PID.
    for (const record of tracking.children) if (!record.closed) record.child.kill('SIGKILL');
    await Promise.all(tracking.children.map(record => record.done));
    tracking.children.length = 0; tracking.events.length = 0;
  }
});

async function fixture(modes: string[], gate?: ReturnType<typeof createOwnedReaderGate>) {
  const dir = await mkdtemp(join(tmpdir(), 'iw-native-source-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'synthetic.db'); await writeFile(path, 'synthetic');
  let count = 0;
  const create = (onChild?: (child: ChildProcess) => void) => new ReadonlyRpcClient({
    context: testContext(),
    executable: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/nonlaunch-source-rpc.mjs', import.meta.url)), path, modes[count++] ?? 'normal'],
    timeoutMs: 5000, shutdownGraceMs: 80,
    ...(onChild ? { onChild } : {}),
  });
  const source = new LiveSource({ context: testContext(), executable: process.execPath, expectedDatabasePath: path, factory: () => {
    if (!gate) return create();
    return gate.factory((register: (child: ChildProcess) => void) => create(register));
  } });
  cleanups.push(() => source.close().catch(() => {}));
  return source;
}

it('waits for bootstrap child close before spawning the usable reader, then closes both normally', async () => {
  const source = await fixture(['normal', 'normal']);
  await source.capabilities();
  expect(tracking.events).toEqual(['spawn-0', 'close-0', 'spawn-1']);
  const chats = await source.chats(50);
  expect((await source.history(chats.chats[0]!.id, 50)).messages).toHaveLength(1);
  await source.close();
  expect(tracking.events).toEqual(['spawn-0', 'close-0', 'spawn-1', 'close-1']);
  expect(tracking.children.every(r => r.closed && r.child.exitCode === 0 && r.child.signalCode === null)).toBe(true);
  await expect(source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
  expect(tracking.children).toHaveLength(2);
});

it('closes a stuck active history child without restarting or leaving its request pending', async () => {
  const source = await fixture(['normal', 'stubborn']);
  const chats = await source.chats(50);
  const child = tracking.children[1]!.child;
  const entered = new Promise<void>(resolve => child.stderr!.once('data', () => resolve()));
  const pending = source.history(chats.chats[0]!.id, 50);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'RPC_CLOSED' });
  await entered;
  await source.close(); await rejected;
  expect(tracking.children.every(r => r.closed)).toBe(true);
  expect(child.signalCode).toBe('SIGKILL');
  await expect(source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
  expect(tracking.children).toHaveLength(2);
});

it('records that successful source bootstrap alone does not prove normal child exit', async () => {
  const source = await fixture(['stubborn', 'normal']);
  await source.capabilities();
  // Current production close() accepts confirmed forced exit. A measurement
  // supervisor must separately reject this arm; do not call it clean shutdown.
  expect(tracking.children[0]!.closed).toBe(true);
  expect(tracking.children[0]!.child.signalCode).toBe('SIGKILL');
  expect(tracking.events).toEqual(['spawn-0', 'close-0', 'spawn-1']);
  await source.close();
  expect(tracking.children.every(r => r.closed)).toBe(true);
});

it('measurement gate rejects forced bootstrap close before a second child can spawn', async () => {
  const gate = createOwnedReaderGate({ graceMs: 100, killWaitMs: 1000 });
  cleanups.push(() => gate.close());
  const source = await fixture(['stubborn', 'normal'], gate);
  await expect(source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
  expect(tracking.children).toHaveLength(1);
  await expect(source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
  expect(await gate.close()).toEqual({ gateMeasurement: false, children: 1, allClosed: true, allNormal: false, signalAttempted: true });
});

it('measurement gate accepts normal bootstrap and shutdown while preventing future construction', async () => {
  const gate = createOwnedReaderGate({ graceMs: 100, killWaitMs: 1000 });
  cleanups.push(() => gate.close());
  const source = await fixture(['normal', 'normal'], gate);
  await source.capabilities();
  await source.close();
  expect(await gate.close()).toEqual({ gateMeasurement: false, children: 2, allClosed: true, allNormal: true, signalAttempted: false });
  expect(() => gate.factory(() => { throw new Error('must not run'); })).toThrow('OWNED_READER_FAILED');
});

it.each(['normal', 'stubborn'])('joined session owns HTTP, auth and native %s bootstrap cleanup', async mode => {
  const gate = createOwnedReaderGate({ graceMs: 200, killWaitMs: 1000 });
  cleanups.push(() => gate.close());
  const source = await fixture([mode, 'normal'], gate);
  const key = 'A'.repeat(43), origin = 'https://imsg.synthetic.test';
  const auth = new Auth(hashKey(key));
  const app = await createApp({ auth, source, origin });
  cleanups.push(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const report = await runApiSession({ app, auth, source, readers: gate, key, origin });
  expect(report.outcome).toBe(mode === 'normal' ? 'ok' : 'failed');
  expect(report.cleanup).toMatchObject({ revoked: true, transportClosed: true, readersClosed: true, appClosed: true });
  expect(report.cleanup.readersNormal).toBe(mode === 'normal');
  expect(auth.count).toBe(0);
  expect(app.server.listening).toBe(false);
  expect(tracking.children).toHaveLength(mode === 'normal' ? 2 : 1);
  expect(tracking.children.every(r => r.closed)).toBe(true);
  if (mode !== 'normal') expect(report.sample).toBeNull();
});
