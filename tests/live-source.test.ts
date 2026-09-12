import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, rename, writeFile, rm, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveSource, clip } from '../src/server/live-source.js';
import { testContext } from './helpers/child-context.js';
const { forbiddenCli, forbiddenSpawn } = vi.hoisted(() => ({ forbiddenCli: vi.fn(), forbiddenSpawn: vi.fn() }));
vi.mock('../src/server/cli-status.js', () => ({ cliStatus: forbiddenCli }));
vi.mock('node:child_process', () => ({ spawn: forbiddenSpawn }));

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'iw-source-')), path = join(dir, 'chat.db');
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path, 'old');
  const handles: FileHandle[] = [], calls: string[] = [];
  let created = 0, living = 0, maximum = 0, failClose = false, offset = 0;
  let hold: ReturnType<typeof deferred<void>> | undefined;
  let beforeStatus: (() => Promise<void>) | undefined;
  const status = () => ({ version: '0.15.1', protocol_version: 1, database: { ready: true, path }, bridge: { ready: false }, contacts: { available: false }, methods: ['status', 'chats.list', 'messages.history'] });
  const factory = () => {
    created++; living++; maximum = Math.max(maximum, living);
    let closed = false;
    const handle = open(path).then(h => { handles.push(h); return h; });
    return { get closed() { return closed; }, async close() {
      if (failClose) throw new Error('synthetic close failure');
      if (!closed) { closed = true; living--; await (await handle).close(); }
    }, async request(method: string, params: Record<string, unknown> = {}) {
      calls.push(method);
      if (method === 'status') { await handle; if (beforeStatus) { const task = beforeStatus; beforeStatus = undefined; await task(); } return status(); }
      await hold?.promise;
      if (closed) throw new Error('reader closed');
      if (method === 'chats.list') return { chats: Array.from({ length: Number(params.limit) }, (_, i) => ({ id: offset + i + 1, guid: `chat-${offset + i}`, name: '', identifier: 'Synthetic conversation', service: 'iMessage' })) };
      if (method === 'messages.history') {
        const buffer = Buffer.alloc(16); const { bytesRead } = await (await handle).read(buffer, 0, 16, 0);
        return { messages: [{ id: 2, chat_id: params.chat_id, guid: 'm-2', text: buffer.subarray(0, bytesRead).toString(), is_from_me: false }, { id: 1, chat_id: params.chat_id, guid: 'm-1', text: 'earlier', is_from_me: true }] };
      }
      throw new Error('unexpected method');
    } };
  };
  const source = new LiveSource({ context: testContext(), executable: '/synthetic/imsg', expectedDatabasePath: path, factory });
  cleanups.push(async () => { failClose = false; hold?.resolve(); await source.close().catch(() => {}); for (const h of handles) await h.close().catch(() => {}); });
  const replace = async () => { await writeFile(join(dir, 'replacement'), 'new'); await rename(join(dir, 'replacement'), path); };
  return { source, calls, replace, removeDB: () => unlink(path), get created() { return created; }, get maximum() { return maximum; }, setOffset: (n: number) => { offset = n; }, setFailClose: () => { failClose = true; }, hold: () => { hold = deferred<void>(); return hold; }, onStatus: (task: () => Promise<void>) => { beforeStatus = task; } };
}
describe('B04 DB generation and reader lifetime', () => {
  it('bootstraps only path then opens a reader after stat, keeps raw IDs private, reverses history, keeps unknown fields null', async () => {
    const f = await setup(); f.onStatus(f.replace);
    const chats = await f.source.chats(50);
    expect(f.created).toBe(2); expect(f.maximum).toBe(1);
    const c = chats.chats[0]!;
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(c).toMatchObject({ name: 'Synthetic conversation', unreadCount: null, isGroup: null, lastMessageAt: null });
    const history = await f.source.history(c.id, 50);
    expect(history.messages.map(m => m.text)).toEqual(['earlier', 'new']);
    expect(JSON.stringify(chats)).not.toContain('chat-0');
  });
  it('rejects inode replacement with an old handle and never transfers old opaque ID to reused rowid', async () => {
    const f = await setup(); const old = await f.source.chats(50);
    await f.replace();
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'DB_CHANGED', status: 409 });
    const fresh = await f.source.chats(50);
    expect(fresh.epoch).not.toBe(old.epoch); expect(f.maximum).toBe(1);
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT' });
    expect((await f.source.history(fresh.chats[0]!.id, 50)).messages[1]!.text).toBe('new');
  });
  it('discards a result if inode changes during the read', async () => {
    const f = await setup(); const old = await f.source.chats(50), gate = f.hold();
    const pending = f.source.history(old.chats[0]!.id, 50);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'DB_CHANGED' });
    await vi.waitFor(() => expect(f.calls).toContain('messages.history'));
    await f.replace(); gate.resolve(); await assertion;
  });
  it('returns409 when an established DB disappears and invalidates the old ID', async () => {
    const f = await setup(); const old = await f.source.chats(50); await f.removeDB();
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'DB_CHANGED', status: 409 });
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT', status: 409 });
  });
  it('coalesces only equal requests; bounds one active plus32 waiting and refuses recovery after failed close', async () => {
    const f = await setup(); await f.source.chats(50); const gate = f.hold();
    const a = f.source.chats(50); expect(f.source.chats(50)).toBe(a);
    const jobs = [a, ...Array.from({ length: 32 }, (_, i) => f.source.chats(i + 51))];
    await expect(f.source.chats(999)).rejects.toMatchObject({ code: 'BUSY', status: 429 });
    gate.resolve(); await Promise.all(jobs);
    const count = f.created; f.setFailClose(); await f.replace();
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    expect(f.created).toBe(count);
  });
  it('rotates at map entry2001, keeps same-epoch IDs stable, and shutdown cannot spawn another child', async () => {
    const f = await setup(); const first = await f.source.chats(1000);
    expect((await f.source.chats(50)).chats[0]!.id).toBe(first.chats[0]!.id);
    f.setOffset(1000); expect((await f.source.chats(1000)).epoch).toBe(first.epoch);
    f.setOffset(2000); const next = await f.source.chats(50); expect(next.epoch).not.toBe(first.epoch);
    await expect(f.source.history(first.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT' });
    const count = f.created; const a = f.source.close(); expect(f.source.close()).toBe(a); await a;
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' }); expect(f.created).toBe(count);
  });
  it('does not split surrogate pairs when clipping', () => { expect(clip('a😀b', 2)).toEqual({ value: 'a', trimmed: true }); expect(clip('😀', 2).trimmed).toBe(false); });
  it('keeps capabilities and concurrent reads free of CLI probes after the former cache interval', async () => {
    const f = await setup();
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(100_000);
      expect((await f.source.capabilities()).features.read).toEqual({ state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' });
      const chats = await f.source.chats(50);
      clock.mockReturnValue(131_001);
      await Promise.all([f.source.capabilities(), f.source.capabilities(), f.source.chats(50), f.source.history(chats.chats[0]!.id, 50)]);
      expect(f.calls).toContain('messages.history');
      expect(f.calls.every(method => ['status', 'chats.list', 'messages.history'].includes(method))).toBe(true);
      expect(forbiddenCli).not.toHaveBeenCalled();
      expect(forbiddenSpawn).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it('does not report clean shutdown after RPC close fails during capability bootstrap', async () => {
    const f = await setup(); f.setFailClose();
    await expect(f.source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    const created = f.created;
    await expect(f.source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    await expect(f.source.close()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    expect(f.created).toBe(created);
  });
});
