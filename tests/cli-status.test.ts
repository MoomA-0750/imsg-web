import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { cliStatus } from '../src/server/cli-status.js';

afterEach(() => vi.useRealTimers());
it('reports failed shutdown and releases inherited pipe handles at its hard deadline', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() });
  spawnMock.mockReturnValue(child);
  const result = cliStatus('/synthetic/imsg');
  const assertion = expect(result).rejects.toMatchObject({ code: 'SHUTDOWN_FAILED' });
  await vi.advanceTimersByTimeAsync(13_000); await assertion;
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
  expect(child.unref).toHaveBeenCalledOnce();
});
