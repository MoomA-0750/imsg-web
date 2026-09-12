import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doctor } from '../src/doctor.js';
import { cliStatus } from '../src/server/cli-status.js';
import { RpcError } from '../src/server/rpc/errors.js';
import { testContext } from './helpers/child-context.js';
vi.mock('../src/server/cli-status.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/server/cli-status.js')>();
  return { cliStatus: vi.fn(actual.cliStatus) };
});

const fake = fileURLToPath(new URL('./fixtures/fake-doctor.mjs', import.meta.url));

/**
 * The fixture used to take its mode and marker from the inherited environment.
 * The child environment is now an allow-list, so that route is closed -- and
 * punching these two variables through it "for tests" would be a hole in the
 * thing being tested. A generated wrapper carries them in globals instead,
 * which is also race-free when files run in parallel.
 */
async function configuredFake(config: { mode?: string; marker?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'doctor-fake-'));
  const path = join(dir, 'fake.mjs');
  await writeFile(path, [
    '#!/usr/bin/env node',
    config.mode ? `globalThis.__doctorMode = ${JSON.stringify(config.mode)};` : '',
    config.marker ? `globalThis.__doctorMarker = ${JSON.stringify(config.marker)};` : '',
    `await import(${JSON.stringify(pathToFileURL(fake).href)});`,
    '',
  ].join('\n'), { mode: 0o700 });
  return path;
}
describe('doctor output and read-only acceptance (synthetic)', () => {
  it('never reports ready when only the CLI process fails to shut down', async () => {
    vi.mocked(cliStatus).mockRejectedValueOnce(new RpcError('SHUTDOWN_FAILED'));
    const report = await doctor(fake, testContext());
    expect(report.checks.history?.state).toBe('passed');
    expect(report.checks.shutdown?.state).toBe('passed');
    expect(report.checks.cliStatus?.reasonCode).toBe('SHUTDOWN_FAILED');
    expect(report.ready).toBe(false);
  });

  it('never emits message, nested reply, path, account, or upstream diagnostic strings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-test-'));
    const marker = join(dir, 'requests');
    const report = await doctor(await configuredFake({ marker }), testContext());
    expect(report.ready).toBe(true);
    expect(report.checks.history?.count).toBe(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_DOCTOR_SENTINEL');
    expect(report.watch).toEqual({ notificationCount: 0, overflowCount: 0, deliveryVerified: false });
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe']);
  });
  it('reports empty chat history as skipped, not tested', async () => {
    const report = await doctor(await configuredFake({ mode: 'empty' }), testContext());
    expect(report.ready).toBe(true);
    expect(report.checks.history).toEqual({ state: 'skipped', reasonCode: 'NO_CHATS' });
  });
  it('reports denied DB as unavailable without dispatching DB operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-denied-'));
    const marker = join(dir, 'requests');
    const report = await doctor(await configuredFake({ mode: 'db-denied', marker }), testContext());
    expect(report.ready).toBe(false);
    expect(report.checks.chats?.state).toBe('skipped');
    expect(report.capabilities.chats.reasonCode).toBe('DATABASE_UNAVAILABLE');
    expect((await readFile(marker, 'utf8')).trim()).toBe('status');
  });
});
