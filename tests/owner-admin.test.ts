import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, lstat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { OwnerStore } from '../src/server/owner-store.js';
import { Auth, hashKey } from '../src/server/auth.js';
import { startAdmin, adminCommand } from '../src/server/admin.js';
import { startRuntime } from '../src/server/runtime.js';
import type { ReadSource } from '../src/shared/web-types.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const c of cleanups.splice(0).reverse()) await c(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'iw-owner-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = new OwnerStore(join(dir, 'state')), key = await store.setup(), auth = new Auth(await store.load());
  return { dir, store, key, auth };
}
describe('B03 owner state and Unix administration / B08 shutdown', () => {
  it('stores only hash with exact private permissions, refuses existing setup and symlink/loose permissions', async () => {
    const f = await setup();
    expect((await lstat(f.store.directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(f.store.directory, 'owner.json'))).mode & 0o777).toBe(0o600);
    expect(await f.store.load()).toBe(hashKey(f.key));
    expect(await readFile(join(f.store.directory, 'owner.json'), 'utf8')).not.toContain(f.key);
    await expect(f.store.setup()).rejects.toBeDefined();
    await chmod(join(f.store.directory, 'owner.json'), 0o644); await expect(f.store.load()).rejects.toMatchObject({ code: 'OWNER_UNSAFE' });
    await chmod(join(f.store.directory, 'owner.json'), 0o600);
    await symlink(f.store.directory, join(f.dir, 'link')); await expect(new OwnerStore(join(f.dir, 'link')).load()).rejects.toMatchObject({ code: 'STATE_DIR_UNSAFE' });
  });
  it('revoke/rotate operate only through private socket, invalidate all sessions; duplicate start never removes original socket/lock', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    const cookie = f.auth.login(f.key).cookie;
    expect((await lstat(join(f.store.directory, 'admin.sock'))).mode & 0o777).toBe(0o600);
    const inode = (await lstat(join(f.store.directory, 'admin.sock'))).ino;
    await expect(startAdmin(f.store, f.auth)).rejects.toBeDefined();
    expect((await lstat(join(f.store.directory, 'admin.sock'))).ino).toBe(inode);
    await adminCommand(f.store, 'revoke'); expect(f.auth.lookup(cookie)).toBeUndefined();
    const old = f.auth.login(f.key).cookie, result = await adminCommand(f.store, 'rotate');
    expect(f.auth.lookup(old)).toBeUndefined(); expect(await f.store.load()).toBe(hashKey(result.key!));
    expect(() => f.auth.login(f.key)).toThrow(); expect(f.auth.login(result.key).cookie).toBeTruthy();
    for (const name of await readdir(f.store.directory)) if (name !== 'admin.sock') expect(await readFile(join(f.store.directory, name), 'utf8')).not.toContain(result.key);
  });
  it('failed persistence after replacement remains blocked and permits re-rotation; lost ACK does not reactivate old key', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    const real = f.store.rotate.bind(f.store);
    vi.spyOn(f.store, 'rotate').mockImplementationOnce(async key => { await real(key); throw new Error('simulated directory fsync failure'); });
    const cookie = f.auth.login(f.key).cookie;
    await expect(adminCommand(f.store, 'rotate')).rejects.toMatchObject({ code: 'ADMIN_COMMAND_FAILED' });
    expect(f.auth.blocked).toBe(true); expect(f.auth.lookup(cookie)).toBeUndefined(); expect(() => f.auth.login(f.key)).toThrow();
    const recovered = await adminCommand(f.store, 'rotate'); expect(f.auth.login(recovered.key)).toBeTruthy();
    const priorHash = await f.store.load();
    await new Promise<void>((resolve, reject) => { const s = createConnection(join(f.store.directory, 'admin.sock')); s.on('error', reject); s.once('connect', () => { s.write('{"command":"rotate"}\n', () => { s.destroy(); resolve(); }); }); });
    await vi.waitFor(async () => expect(await f.store.load()).not.toBe(priorHash));
    const again = await adminCommand(f.store, 'rotate'); expect(f.auth.login(again.key)).toBeTruthy();
  });
  it('normal stop releases owned marker and can restart; failed reader stop retains marker and rejects restart', async () => {
    const f = await setup();
    const source: ReadSource = { chats: vi.fn(), history: vi.fn(), capabilities: vi.fn(), close: vi.fn(async () => {}) };
    const first = await startRuntime({ store: f.store, source, origin: 'https://owner.test', port: 0 });
    const cookie = first.auth.login(f.key).cookie;
    await first.close(); expect(first.auth.lookup(cookie)).toBeUndefined(); await expect(lstat(join(f.store.directory, 'instance.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const second = await startRuntime({ store: f.store, source: { ...source, close: async () => { throw new Error('uncertain'); } }, origin: 'https://owner.test', port: 0 });
    await expect(second.close()).rejects.toThrow(); expect((await lstat(join(f.store.directory, 'instance.lock'))).isFile()).toBe(true);
    await expect(startRuntime({ store: f.store, source, origin: 'https://owner.test', port: 0 })).rejects.toBeDefined();
  });
  it('reloads hash under lock, and never releases ownership while an earlier rotation is writing', async () => {
    const f = await setup(), staleAuth = new Auth(hashKey(f.key));
    await f.store.rotate('B'.repeat(43));
    const admin = await startAdmin(f.store, staleAuth);
    expect(() => staleAuth.login(f.key)).toThrow(); expect(staleAuth.login('B'.repeat(43))).toBeTruthy();
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const real = f.store.rotate.bind(f.store);
    vi.spyOn(f.store, 'rotate').mockImplementationOnce(async key => { await hold; await real(key); });
    const rotation = adminCommand(f.store, 'rotate').catch(() => {});
    await vi.waitFor(() => expect(staleAuth.blocked).toBe(true));
    const close = admin.close(true);
    await expect(startAdmin(f.store, f.auth)).rejects.toBeDefined();
    expect((await lstat(join(f.store.directory, 'instance.lock'))).isFile()).toBe(true);
    release(); await close; await rotation;
    const fresh = await startAdmin(f.store, f.auth); await fresh.close(true);
  });
  it('reports HTTP stop failure even when reader stopped and retains the marker', async () => {
    const f = await setup();
    const source: ReadSource = { chats: vi.fn(), history: vi.fn(), capabilities: vi.fn(), close: vi.fn(async () => {}) };
    const runtime = await startRuntime({ store: f.store, source, origin: 'https://owner.test', port: 0 });
    const actualClose = runtime.app.close.bind(runtime.app);
    // Exercise the no-argument Promise overload; Vitest infers the callback overload.
    vi.spyOn(runtime.app, 'close').mockImplementationOnce((() => Promise.reject(new Error('synthetic HTTP stop error'))) as unknown as typeof runtime.app.close);
    try { await expect(runtime.close()).rejects.toMatchObject({ code: 'SHUTDOWN_INCOMPLETE' }); expect((await lstat(join(f.store.directory, 'instance.lock'))).isFile()).toBe(true); }
    finally { await actualClose(); }
  });
  it('rotation stop deadline retains lock permanently, even if the old write later completes', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth);
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    const real = f.store.rotate.bind(f.store);
    vi.spyOn(f.store, 'rotate').mockImplementationOnce(async key => { await hold; await real(key); });
    const rotation = adminCommand(f.store, 'rotate').catch(() => {});
    await vi.waitFor(() => expect(f.auth.blocked).toBe(true));
    await expect(admin.close(true)).rejects.toMatchObject({ code: 'SHUTDOWN_INCOMPLETE' });
    release(); await rotation;
    await vi.waitFor(async () => expect(await f.store.load()).not.toBe(hashKey(f.key)));
    expect((await lstat(join(f.store.directory, 'instance.lock'))).isFile()).toBe(true);
    await expect(startAdmin(f.store, f.auth)).rejects.toBeDefined();
  }, 10_000);
});
