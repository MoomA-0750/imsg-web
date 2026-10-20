import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, lstat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { OwnerStore } from '../src/server/owner-store.js';
import { Auth, hashKey } from '../src/server/auth.js';
import { startAdmin, adminCommand, clientCommand } from '../src/server/admin.js';
import { startRuntime } from '../src/server/runtime.js';
import type { ReadSource } from '../src/shared/web-types.js';
import type { AttachmentSource } from '../src/server/attachments.js';

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
    expect(await f.store.load()).toEqual({ kind: 'token', hash: hashKey(f.key) });
    expect(await readFile(join(f.store.directory, 'owner.json'), 'utf8')).not.toContain(f.key);
    await expect(f.store.setup()).rejects.toBeDefined();
    await chmod(join(f.store.directory, 'owner.json'), 0o644); await expect(f.store.load()).rejects.toMatchObject({ code: 'OWNER_UNSAFE' });
    await chmod(join(f.store.directory, 'owner.json'), 0o600);
    await symlink(f.store.directory, join(f.dir, 'link')); await expect(new OwnerStore(join(f.dir, 'link')).load()).rejects.toMatchObject({ code: 'STATE_DIR_UNSAFE' });
  });
  it('revoke/rotate operate only through private socket, invalidate all sessions; duplicate start never removes original socket/lock', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    const cookie = (await f.auth.login(f.key)).cookie;
    expect((await lstat(join(f.store.directory, 'admin.sock'))).mode & 0o777).toBe(0o600);
    const inode = (await lstat(join(f.store.directory, 'admin.sock'))).ino;
    await expect(startAdmin(f.store, f.auth)).rejects.toBeDefined();
    expect((await lstat(join(f.store.directory, 'admin.sock'))).ino).toBe(inode);
    await adminCommand(f.store, 'revoke'); expect(f.auth.lookup(cookie)).toBeUndefined();
    const old = (await f.auth.login(f.key)).cookie, result = await adminCommand(f.store, 'rotate');
    expect(f.auth.lookup(old)).toBeUndefined(); expect(await f.store.load()).toEqual({ kind: 'token', hash: hashKey(result.key!) });
    await expect(f.auth.login(f.key)).rejects.toThrow(); expect((await f.auth.login(result.key)).cookie).toBeTruthy();
    for (const name of await readdir(f.store.directory)) if (name !== 'admin.sock') expect(await readFile(join(f.store.directory, name), 'utf8')).not.toContain(result.key);
  });
  it('set-password replaces the generated key, signs everyone out, and refuses one that is too weak', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    const cookie = (await f.auth.login(f.key)).cookie;
    await expect(adminCommand(f.store, 'set-password', 'short1')).rejects.toBeDefined();
    // A refused password changes nothing: the key still works and the session still stands.
    expect(f.auth.lookup(cookie)).toBeDefined();
    expect(await f.auth.login(f.key)).toBeTruthy();

    expect(await adminCommand(f.store, 'set-password', 'kaisha2026')).toEqual({ ok: true });
    expect(f.auth.lookup(cookie)).toBeUndefined();
    await expect(f.auth.login(f.key)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect((await f.auth.login('kaisha2026')).cookie).toBeTruthy();
    expect(f.auth.kind).toBe('password');
    // Salted and stretched on disk, and the password itself is nowhere in the directory.
    expect(await f.store.load()).toMatchObject({ kind: 'password' });
    for (const name of await readdir(f.store.directory)) {
      if (name === 'admin.sock') continue;
      expect(await readFile(join(f.store.directory, name), 'utf8')).not.toContain('kaisha2026');
    }
    // Rotating back to a generated key remains the way out if the password is ever lost.
    const recovered = await adminCommand(f.store, 'rotate');
    expect(f.auth.kind).toBe('token');
    expect(await f.auth.login(recovered.key)).toBeTruthy();
  });
  it('failed persistence after replacement remains blocked and permits re-rotation; lost ACK does not reactivate old key', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    const real = f.store.rotate.bind(f.store);
    vi.spyOn(f.store, 'rotate').mockImplementationOnce(async credential => { await real(credential); throw new Error('simulated directory fsync failure'); });
    const cookie = (await f.auth.login(f.key)).cookie;
    await expect(adminCommand(f.store, 'rotate')).rejects.toMatchObject({ code: 'ADMIN_COMMAND_FAILED' });
    expect(f.auth.blocked).toBe(true); expect(f.auth.lookup(cookie)).toBeUndefined(); await expect(f.auth.login(f.key)).rejects.toThrow();
    const recovered = await adminCommand(f.store, 'rotate'); expect(await f.auth.login(recovered.key)).toBeTruthy();
    const priorHash = JSON.stringify(await f.store.load());
    await new Promise<void>((resolve, reject) => { const s = createConnection(join(f.store.directory, 'admin.sock')); s.on('error', reject); s.once('connect', () => { s.write('{"command":"rotate"}\n', () => { s.destroy(); resolve(); }); }); });
    await vi.waitFor(async () => expect(JSON.stringify(await f.store.load())).not.toBe(priorHash));
    const again = await adminCommand(f.store, 'rotate'); expect(await f.auth.login(again.key)).toBeTruthy();
  });
  it('normal stop releases owned marker and can restart; failed reader stop retains marker and rejects restart', async () => {
    const f = await setup();
    const source: ReadSource & AttachmentSource = { chats: vi.fn(), history: vi.fn(), capabilities: vi.fn(), attachment: vi.fn(), avatar: vi.fn(), close: vi.fn(async () => {}) };
    const first = await startRuntime({ store: f.store, source, origins: ['https://owner.test'], port: 0 });
    const cookie = (await first.auth.login(f.key)).cookie;
    await first.close(); expect(first.auth.lookup(cookie)).toBeUndefined(); await expect(lstat(join(f.store.directory, 'instance.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const second = await startRuntime({ store: f.store, source: { ...source, close: async () => { throw new Error('uncertain'); } }, origins: ['https://owner.test'], port: 0 });
    await expect(second.close()).rejects.toThrow(); expect((await lstat(join(f.store.directory, 'instance.lock'))).isFile()).toBe(true);
    await expect(startRuntime({ store: f.store, source, origins: ['https://owner.test'], port: 0 })).rejects.toBeDefined();
  });
  it('reloads hash under lock, and never releases ownership while an earlier rotation is writing', async () => {
    const f = await setup(), staleAuth = new Auth(hashKey(f.key));
    await f.store.rotate({ kind: 'token', hash: hashKey('B'.repeat(43)) });
    const admin = await startAdmin(f.store, staleAuth);
    await expect(staleAuth.login(f.key)).rejects.toThrow(); expect(await staleAuth.login('B'.repeat(43))).toBeTruthy();
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
    const source: ReadSource & AttachmentSource = { chats: vi.fn(), history: vi.fn(), capabilities: vi.fn(), attachment: vi.fn(), avatar: vi.fn(), close: vi.fn(async () => {}) };
    const runtime = await startRuntime({ store: f.store, source, origins: ['https://owner.test'], port: 0 });
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

describe('a temporary password to start with, and a password of the owner’s own after the first sign-in', () => {
  it('hands out a readable temporary password, stored stretched and marked temporary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-temp-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // The installer lays the state directory out first; this adopts it, but only as the owner's 0700.
    const store = new OwnerStore(join(dir, 'state'));
    await mkdir(store.directory, { mode: 0o755 }); await expect(store.setupTemporary()).rejects.toMatchObject({ code: 'STATE_DIR_UNSAFE' });
    await chmod(store.directory, 0o700);
    const password = await store.setupTemporary();
    expect(password).toMatch(/^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
    expect(await store.load()).toMatchObject({ kind: 'password', temporary: true });
    expect(await readFile(join(store.directory, 'owner.json'), 'utf8')).not.toContain(password);
    await expect(store.setupTemporary()).rejects.toBeDefined(); // never replaces a credential
    const auth = new Auth(await store.load());
    expect(auth.mustSetPassword).toBe(true);
    expect((await auth.login(password)).cookie).toBeTruthy();
  });

  it('asks for a password after the first sign-in, takes one that is good enough, and keeps the owner signed in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-first-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const store = new OwnerStore(join(dir, 'state'));
    await mkdir(store.directory, { mode: 0o700 });
    const temporary = await store.setupTemporary();
    const source: ReadSource & AttachmentSource = { chats: vi.fn(async () => ({ epoch: 'e', limit: 50, chats: [] })), history: vi.fn(), capabilities: vi.fn(), attachment: vi.fn(), avatar: vi.fn(), close: vi.fn(async () => {}) };
    const runtime = await startRuntime({ store, source, origins: ['https://owner.test'], port: 0 });
    cleanups.push(() => runtime.close());
    const headers = { host: 'owner.test', origin: 'https://owner.test', 'content-type': 'application/json' };
    const signIn = (key: string) => runtime.app.inject({ method: 'POST', url: '/api/session', headers, payload: { key } });
    const first = await signIn(temporary);
    expect(first.json()).toMatchObject({ mustSetPassword: true });
    const cookie = (first.headers['set-cookie'] as string).split(';')[0]!, csrf = first.json<{ csrfToken: string }>().csrfToken;
    const choose = (password: string, c = cookie, token = csrf) => runtime.app.inject({ method: 'POST', url: '/api/password', headers: { ...headers, cookie: c, 'x-csrf-token': token }, payload: { password } });

    // Too weak, or without the CSRF token: refused, and the temporary password still stands.
    expect((await choose('short1')).json()).toEqual({ code: 'PASSWORD_WEAK' });
    expect((await choose('kaisha2026', cookie, 'x'.repeat(43))).statusCode).toBe(403);
    expect((await store.load())).toMatchObject({ temporary: true });

    const chosen = await choose('kaisha2026');
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json()).toMatchObject({ mustSetPassword: false });
    // Signed straight back in: the new cookie works, the old one does not.
    const fresh = (chosen.headers['set-cookie'] as string).split(';')[0]!;
    expect((await runtime.app.inject({ url: '/api/session', headers: { ...headers, cookie: fresh } })).json()).toMatchObject({ mustSetPassword: false });
    expect((await runtime.app.inject({ url: '/api/session', headers: { ...headers, cookie } })).statusCode).toBe(401);
    expect(await store.load()).toMatchObject({ kind: 'password' });
    expect(await store.load()).not.toHaveProperty('temporary');
    expect((await signIn(temporary)).statusCode).toBe(401);
    expect((await signIn('kaisha2026')).statusCode).toBe(200);
    // Once there is a password of the owner's own, changing it is a thing done on the Mac.
    expect((await choose('another2026', fresh, chosen.json<{ csrfToken: string }>().csrfToken)).json()).toEqual({ code: 'PASSWORD_ALREADY_SET' });
  }, 15_000);
});

describe('clients let in to the API', () => {
  it('adds, lists and removes clients through the private socket, keeping only hashes on disk', async () => {
    const f = await setup(), admin = await startAdmin(f.store, f.auth); cleanups.push(() => admin.close(true));
    expect(await clientCommand(f.store, { command: 'client-list' })).toEqual({ clients: [] });
    const { token } = await clientCommand(f.store, { command: 'client-add', name: 'dashboard', scope: 'send' });
    expect(f.auth.client(token)).toMatchObject({ name: 'dashboard', scope: 'send' });
    const file = join(f.store.directory, 'clients.json');
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain(token!);
    expect(await readFile(file, 'utf8')).toContain(hashKey(token!));
    await expect(clientCommand(f.store, { command: 'client-add', name: 'dashboard', scope: 'read' })).rejects.toMatchObject({ code: 'CLIENT_EXISTS' });
    const listed = await clientCommand(f.store, { command: 'client-list' });
    expect(listed.clients).toEqual([{ name: 'dashboard', scope: 'send', created: expect.any(Number) }]);
    expect(JSON.stringify(listed)).not.toContain(hashKey(token!));
    // The owner's password changing does not cut the program off.
    expect(await adminCommand(f.store, 'set-password', 'kaisha2026')).toEqual({ ok: true });
    expect(f.auth.client(token)).toBeDefined();
    expect(await clientCommand(f.store, { command: 'client-remove', name: 'dashboard' })).toEqual({ ok: true });
    expect(f.auth.client(token)).toBeUndefined();
    await expect(clientCommand(f.store, { command: 'client-remove', name: 'dashboard' })).rejects.toMatchObject({ code: 'CLIENT_UNKNOWN' });
  });
  it('refuses malformed client requests and loads saved clients when the server starts', async () => {
    const f = await setup();
    let admin = await startAdmin(f.store, f.auth);
    for (const bad of [{ command: 'client-add', name: 'Bad Name', scope: 'read' }, { command: 'client-add', name: 'ok', scope: 'admin' }, { command: 'client-add', name: 'ok' }, { command: 'client-list', extra: 1 }]) {
      await expect(clientCommand(f.store, bad as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    const { token } = await clientCommand(f.store, { command: 'client-add', name: 'reader', scope: 'read' });
    await admin.close(true);
    const fresh = new Auth(await f.store.load());
    admin = await startAdmin(f.store, fresh); cleanups.push(() => admin.close(true));
    expect(fresh.client(token)).toMatchObject({ name: 'reader', scope: 'read' });
  });
  it('refuses a clients file that is loose, linked or malformed', async () => {
    const f = await setup();
    await f.store.saveClients([{ name: 'a', scope: 'read', hash: 'a'.repeat(64), created: 1 }]);
    const file = join(f.store.directory, 'clients.json');
    await chmod(file, 0o644); await expect(f.store.loadClients()).rejects.toMatchObject({ code: 'CLIENTS_UNSAFE' });
    await rm(file); await symlink(join(f.dir, 'elsewhere'), file); await expect(f.store.loadClients()).rejects.toBeDefined();
    await rm(file); await f.store.saveClients([{ name: 'a', scope: 'read', hash: 'a'.repeat(64), created: 1 }, { name: 'a', scope: 'send', hash: 'b'.repeat(64), created: 1 }]);
    await expect(f.store.loadClients()).rejects.toMatchObject({ code: 'CLIENTS_INVALID' });
  });
});
