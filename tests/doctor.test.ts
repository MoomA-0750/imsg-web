import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doctor } from '../src/doctor.js';
import { cliStatus } from '../src/server/cli-status.js';
import { RpcError } from '../src/server/rpc/errors.js';
vi.mock('../src/server/cli-status.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/server/cli-status.js')>();
  return { cliStatus: vi.fn(actual.cliStatus) };
});

const fake = fileURLToPath(new URL('./fixtures/fake-doctor.mjs', import.meta.url));
afterEach(() => vi.unstubAllEnvs());
describe('doctor output and read-only acceptance (synthetic)', () => {
  it('never reports ready when only the CLI process fails to shut down', async () => {
    vi.mocked(cliStatus).mockRejectedValueOnce(new RpcError('SHUTDOWN_FAILED'));
    const report = await doctor(fake);
    expect(report.checks.history?.state).toBe('passed');
    expect(report.checks.shutdown?.state).toBe('passed');
    expect(report.checks.cliStatus?.reasonCode).toBe('SHUTDOWN_FAILED');
    expect(report.ready).toBe(false);
  });

  it('never emits message, nested reply, path, account, or upstream diagnostic strings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-test-'));
    const marker = join(dir, 'requests');
    vi.stubEnv('DOCTOR_TEST_MARKER', marker);
    const report = await doctor(fake);
    expect(report.ready).toBe(true);
    expect(report.checks.history?.count).toBe(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_DOCTOR_SENTINEL');
    expect(report.watch).toEqual({ notificationCount: 0, overflowCount: 0, deliveryVerified: false });
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe']);
  });
  it('reports empty chat history as skipped, not tested', async () => {
    vi.stubEnv('DOCTOR_TEST_MODE', 'empty');
    const report = await doctor(fake);
    expect(report.ready).toBe(true);
    expect(report.checks.history).toEqual({ state: 'skipped', reasonCode: 'NO_CHATS' });
  });
  it('reports denied DB as unavailable without dispatching DB operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-denied-'));
    const marker = join(dir, 'requests');
    vi.stubEnv('DOCTOR_TEST_MARKER', marker); vi.stubEnv('DOCTOR_TEST_MODE', 'db-denied');
    const report = await doctor(fake);
    expect(report.ready).toBe(false);
    expect(report.checks.chats?.state).toBe('skipped');
    expect(report.capabilities.chats.reasonCode).toBe('DATABASE_UNAVAILABLE');
    expect((await readFile(marker, 'utf8')).trim()).toBe('status');
  });
});
