import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { ReadonlyRpcClient } from '../src/server/rpc/readonly-client.js';
import { testContext } from './helpers/child-context.js';
afterEach(() => vi.useRealTimers());

it('destroys all RPC pipe handles and unrefs only its own child at the hard shutdown deadline', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(), unref: vi.fn(),
  });
  spawnMock.mockReturnValue(child);
  const client = new ReadonlyRpcClient({ context: testContext(), executable: '/synthetic/imsg' });
  const pending = client.request('status').catch(error => error);
  const closing = client.close();
  const assertion = expect(closing).rejects.toMatchObject({ code: 'SHUTDOWN_FAILED' });
  await vi.advanceTimersByTimeAsync(5_000); await assertion;
  expect(await pending).toMatchObject({ code: 'RPC_CLOSED' });
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(child.stdin.destroyed).toBe(true);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(child.unref).toHaveBeenCalledOnce();
  expect(client.counts).toEqual({ active: 0, queued: 0 });
});
