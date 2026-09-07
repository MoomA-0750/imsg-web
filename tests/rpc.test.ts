import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReadonlyRpcClient, type ReadMethod } from '../src/server/rpc/readonly-client.js';
import { RpcError } from '../src/server/rpc/errors.js';

const fixture = resolve(fileURLToPath(new URL('./fixtures/fake-imsg.mjs', import.meta.url)));
const code = (error: unknown) => error instanceof RpcError ? error.code : undefined;
const make = (mode: string, options: { timeoutMs?: number; shutdownGraceMs?: number; maxFrameBytes?: number; marker?: string } = {}) => {
  const config = {
    executable: process.execPath,
    args: [fixture, mode, ...(options.marker ? [options.marker] : [])],
    timeoutMs: options.timeoutMs ?? 1_000,
    shutdownGraceMs: options.shutdownGraceMs ?? 40,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
  };
  return new ReadonlyRpcClient(config);
};

async function using<T>(client: ReadonlyRpcClient, body: () => Promise<T>): Promise<T> {
  try { return await body(); } finally { await client.close(); }
}

describe('ReadonlyRpcClient subprocess acceptance', () => {
  it('detaches inherited pipes on failed shutdown without signalling grandchildren', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-inherited-'));
    const marker = join(dir, 'requests');
    const client = make('inherited-pipe', { marker, timeoutMs: 100, shutdownGraceMs: 40 });
    await expect(client.request('status')).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
    const started = performance.now();
    await expect(client.close()).rejects.toMatchObject({ code: 'SHUTDOWN_FAILED' });
    expect(performance.now() - started).toBeLessThan(1500);
    const record = await readFile(marker, 'utf8');
    const helper = Number(/HELPER:(\d+)/.exec(record)?.[1]);
    expect(helper).toBeGreaterThan(0);
    expect(() => process.kill(helper, 0)).not.toThrow();
    // Natural expiry only; no process-tree kill during test cleanup.
    await new Promise(resolve => setTimeout(resolve, 900));
  });

  it('close rejects newly submitted work synchronously', async () => {
    const client = make('echo');
    const closing = client.close();
    await expect(client.request('status')).rejects.toMatchObject({ code: 'RPC_CLOSED' });
    await closing;
  });

  it('redacts upstream error message and data while retaining the numeric classification', async () => {
    const client = make('remote-error');
    await using(client, async () => {
      const error = await client.request('status').catch(error => error);
      expect(error).toMatchObject({ code: 'RPC_REMOTE_ERROR', remoteCode: -32002 });
      expect(String(error) + JSON.stringify(error)).not.toContain('PRIVATE_');
    });
  });

  it('terminates its own child when EOF and SIGTERM are ignored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-shutdown-'));
    const marker = join(dir, 'requests');
    const client = make('ignore-shutdown', { marker, timeoutMs: 5000, shutdownGraceMs: 80 });
    await using(client, async () => {
      const pending = client.request('status').catch(error => error);
      let record = '';
      for (let i = 0; i < 100; i++) {
        record = await readFile(marker, 'utf8').catch(() => '');
        if (record.includes('status')) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const pid = Number(/PID:(\d+)/.exec(record)?.[1]);
      expect(pid).toBeGreaterThan(0);
      const start = performance.now();
      await client.close();
      expect(performance.now() - start).toBeLessThan(1200);
      expect(await pending).toMatchObject({ code: 'RPC_CLOSED' });
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('correlates string IDs in reverse order and handles multiple lines plus a notice', async () => {
    const client = make('reverse-two');
    await using(client, async () => {
      const notices: unknown[] = [];
      client.onNotice(n => notices.push(n));
      const first = client.request('status');
      const second = client.request('chats.list');
      await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
      expect(notices).toEqual([{ method: 'event.synthetic', params: { safe: true } }]);
    });
  });

  it('decodes a multibyte UTF-8 character split across chunks', async () => {
    const client = make('utf8-split');
    await using(client, async () => expect(client.request('status')).resolves.toBe('雪'));
  });

  it.each([
    ['bad-json', 'RPC_PROTOCOL_INVALID'],
    ['partial-eof', 'RPC_PROTOCOL_INVALID'],
    ['eof', 'RPC_EOF'],
  ] as const)('fails all work safely on %s', async (mode, expected) => {
    const client = make(mode);
    await using(client, async () => {
      const settled = await Promise.allSettled([client.request('status'), client.request('chats.list')]);
      expect(settled.every(x => x.status === 'rejected' && code(x.reason) === expected)).toBe(true);
      expect(client.counts).toEqual({ active: 0, queued: 0 });
    });
  });

  it('enforces the stdout frame byte limit', async () => {
    const client = make('oversize', { maxFrameBytes: 4096 });
    await using(client, async () => {
      await expect(client.request('status')).rejects.toMatchObject({ code: 'RPC_FRAME_TOO_LARGE' });
    });
  });

  it('drains a stderr flood without logging it or deadlocking', async () => {
    const client = make('stderr-flood');
    await using(client, async () => expect(client.request('status')).resolves.toBe('drained'));
  });

  it('caps total dispatch at 4 active and 32 queued; request 37 is rejected immediately', async () => {
    const client = make('hold', { timeoutMs: 5_000 });
    await using(client, async () => {
      const accepted = Array.from({ length: 36 }, () => client.request('status').catch(error => error));
      expect(client.counts).toEqual({ active: 4, queued: 32 });
      await expect(client.request('status')).rejects.toMatchObject({ code: 'QUEUE_OVERFLOW' });
      expect(client.counts).toEqual({ active: 4, queued: 32 });
      expect(accepted).toHaveLength(36);
    });
  });

  it('an active timeout closes the child, fails every pending request, and never dispatches queued work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-timeout-'));
    const marker = join(dir, 'requests');
    const client = make('hold', { timeoutMs: 80, marker });
    await using(client, async () => {
      const pending = Array.from({ length: 12 }, () => client.request('status'));
      const settled = await Promise.allSettled(pending);
      expect(code((settled[0] as PromiseRejectedResult).reason)).toBe('RPC_TIMEOUT');
      expect(settled.every(x => x.status === 'rejected')).toBe(true);
      expect(client.closed).toBe(true);
      await expect(client.request('status')).rejects.toMatchObject({ code: 'RPC_CLOSED' });
      const lines = (await readFile(marker, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(4);
    });
  });

  it('an active abort closes the child and fails all active and queued work', async () => {
    const client = make('hold', { timeoutMs: 5_000 });
    await using(client, async () => {
      const controller = new AbortController();
      const pending = [client.request('watch.subscribe', {}, controller.signal), ...Array.from({ length: 8 }, () => client.request('status'))];
      controller.abort();
      const settled = await Promise.allSettled(pending);
      expect(settled.every(x => x.status === 'rejected' && code(x.reason) === 'ABORTED')).toBe(true);
      expect(client.counts).toEqual({ active: 0, queued: 0 });
    });
  });

  it('removes an aborted queued request without closing or freeing a dispatch slot', async () => {
    const client = make('hold', { timeoutMs: 5_000 });
    await using(client, async () => {
      const active = Array.from({ length: 4 }, () => client.request('status').catch(error => error));
      const controller = new AbortController();
      const queued = client.request('chats.list', {}, controller.signal);
      expect(client.counts).toEqual({ active: 4, queued: 1 });
      controller.abort();
      await expect(queued).rejects.toMatchObject({ code: 'ABORTED' });
      expect(client.closed).toBe(false);
      expect(client.counts).toEqual({ active: 4, queued: 0 });
      expect(active).toHaveLength(4);
    });
  });

  it('does not redispatch after a late subscribe response', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-late-'));
    const marker = join(dir, 'requests');
    const client = make('late-subscribe', { timeoutMs: 50, shutdownGraceMs: 250, marker });
    await using(client, async () => {
      await expect(client.request('watch.subscribe')).rejects.toMatchObject({ code: 'RPC_TIMEOUT' });
      await new Promise(resolve => setTimeout(resolve, 120));
      await expect(client.request('watch.subscribe')).rejects.toMatchObject({ code: 'RPC_CLOSED' });
      expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(['watch.subscribe', 'LATE_RESPONSE_SENT']);
    });
  });

  it('ignores a numeric lookalike ID until the exact string ID arrives', async () => {
    const client = make('numeric-lookalike');
    await using(client, async () => expect(client.request('status')).resolves.toBe('right'));
  });

  it('ignores duplicate resolved responses and does not resolve another request with them', async () => {
    const client = make('duplicate');
    await using(client, async () => {
      await expect(client.request('status')).resolves.toBe('once');
      await expect(client.request('chats.list')).resolves.toBe('once');
    });
  });

  it('forwards unknown well-formed notifications without confusing them with responses', async () => {
    const client = make('unknown-notice');
    await using(client, async () => {
      const notices: unknown[] = [];
      client.onNotice(n => notices.push(n));
      await expect(client.request('status')).resolves.toBe('ok');
      expect(notices).toEqual([{ method: 'future.notice', params: { value: 1 } }]);
    });
  });

  it('never dispatches mutation or arbitrary methods', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-readonly-'));
    const marker = join(dir, 'requests');
    const client = make('echo', { marker });
    await using(client, async () => {
      for (const forbidden of ['send', 'messages.markRead', 'typing.set', 'arbitrary']) {
        await expect(client.request(forbidden as ReadMethod)).rejects.toMatchObject({ code: 'METHOD_FORBIDDEN' });
      }
      const allowed: ReadMethod[] = ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'];
      await Promise.all(allowed.map(method => client.request(method)));
      expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(allowed);
    });
  });
});
