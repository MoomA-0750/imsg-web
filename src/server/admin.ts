import { constants } from 'node:fs';
import { chmod, lstat, open, unlink } from 'node:fs/promises';
import { createServer, createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { Auth, hashKey, hashPassword, newToken, passwordProblem, type Credential } from './auth.js';
import { OwnerStore } from './owner-store.js';
import { WebError } from './web-error.js';

export async function startAdmin(store: OwnerStore, auth: Auth) {
  await store.validate();
  const lockPath = join(store.directory, 'instance.lock'), socketPath = join(store.directory, 'admin.sock');
  if (Buffer.byteLength(socketPath) > 100) throw new WebError('STATE_PATH_TOO_LONG');
  // Never remove a marker or socket belonging to another instance, even if stale.
  const lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  const ownLock = await lock.stat();
  await lock.close();
  let ownedSocket = false, rotating = false, stopping = false;
  let rotationWork: Promise<void> | undefined;
  const sockets = new Set<Socket>();
  const removeLock = async () => {
    const current = await lstat(lockPath);
    if (current.ino === ownLock.ino && current.dev === ownLock.dev && !current.isSymbolicLink()) await unlink(lockPath);
  };
  const server = createServer(socket => {
    if (stopping || sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setTimeout(5000, () => socket.destroy());
    let data = Buffer.alloc(0), handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      data = Buffer.concat([data, chunk]);
      if (data.length > 2048) { handled = true; socket.end('{"code":"INVALID_REQUEST"}\n'); return; }
      if (!data.includes(10)) return;
      handled = true;
      void (async () => {
        try {
          const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
          if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('command' in raw)) throw new WebError('INVALID_REQUEST', 400);
          const keys = Object.keys(raw);
          if (raw.command === 'set-password') {
            if (keys.length !== 2 || !('password' in raw)) throw new WebError('INVALID_REQUEST', 400);
            const problem = passwordProblem(raw.password);
            if (problem) throw new WebError('PASSWORD_WEAK', 400);
          } else if (keys.length !== 1) throw new WebError('INVALID_REQUEST', 400);
          if (raw.command === 'status') { socket.end(`${JSON.stringify({ blocked: auth.blocked, sessions: auth.count, rotating })}\n`); return; }
          if (raw.command === 'revoke') { auth.revokeAll(); socket.end('{"ok":true}\n'); return; }
          if (raw.command !== 'rotate' && raw.command !== 'set-password') throw new WebError('INVALID_REQUEST', 400);
          if (rotating) throw new WebError('ADMIN_BUSY', 429);
          // Derive before blocking, so a password the owner mistyped costs them nothing.
          const setting = raw.command === 'set-password';
          const key = setting ? undefined : newToken();
          const credential: Credential = setting ? await hashPassword((raw as { password?: unknown }).password as string) : { kind: 'token', hash: hashKey(key!) };
          rotating = true; auth.block();
          try {
            rotationWork = store.rotate(credential);
            await rotationWork;
            if (stopping) throw new WebError('STOPPING');
            auth.activate(credential);
            socket.end(`${JSON.stringify(setting ? { ok: true } : { key })}\n`);
          } finally { rotating = false; rotationWork = undefined; }
        } catch (error) { socket.end(`${JSON.stringify({ code: error instanceof WebError ? error.code : 'AUTH_RECOVERY_REQUIRED' })}\n`); }
      })();
    });
  });
  try {
    // The disk hash is authoritative only AFTER exclusive ownership. A previous
    // instance may have rotated between a caller's earlier read and this lock.
    auth.block(); auth.activate(await store.load());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
    ownedSocket = true;
    await chmod(socketPath, 0o600);
  } catch (error) {
    if (ownedSocket) await new Promise<void>(resolve => server.close(() => resolve()));
    await removeLock(); throw error;
  }
  return {
    async close(releaseLock: boolean) {
      stopping = true; auth.block();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (rotationWork) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([rotationWork, new Promise((_, reject) => { timer = setTimeout(() => reject(new WebError('SHUTDOWN_INCOMPLETE')), 5000); })]); }
        finally { clearTimeout(timer); }
      }
      // Node owns/unlinks only its listening socket. Retain lock on uncertain reader stop.
      if (releaseLock) await removeLock();
    },
  };
}

export async function adminCommand(store: OwnerStore, command: 'revoke' | 'rotate' | 'status' | 'set-password', password?: string): Promise<{ key?: string; ok?: boolean; blocked?: boolean; sessions?: number; rotating?: boolean }> {
  await store.validate();
  const path = join(store.directory, 'admin.sock');
  const s = await lstat(path);
  if (!s.isSocket() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid?.()) throw new WebError('ADMIN_UNSAFE');
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const fail = () => { socket.destroy(); reject(new WebError('ADMIN_UNAVAILABLE')); };
    socket.setTimeout(5000, fail); socket.on('error', fail);
    socket.once('connect', () => socket.write(`${JSON.stringify(command === 'set-password' ? { command, password } : { command })}\n`));
    let data = Buffer.alloc(0);
    socket.on('data', chunk => { data = Buffer.concat([data, chunk]); if (data.length > 2048) fail(); });
    socket.once('end', () => {
      socket.destroy();
      try {
        const raw = JSON.parse(data.toString('utf8')) as { key?: string; ok?: boolean; code?: string; blocked?: boolean; sessions?: number; rotating?: boolean };
        if (raw.code || (command === 'rotate' ? typeof raw.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.key) : command === 'status' ? typeof raw.blocked !== 'boolean' || !Number.isSafeInteger(raw.sessions) || typeof raw.rotating !== 'boolean' : raw.ok !== true)) throw new Error();
        resolve(raw);
      } catch { reject(new WebError('ADMIN_COMMAND_FAILED')); }
    });
  });
}
