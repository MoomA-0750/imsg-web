import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';

const fail = () => { throw new Error('BUNDLE_REJECTED'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = p => typeof p === 'string' && p.length <= 1024 && !/[\\\x00-\x1f\x7f]/.test(p)
  && p.split('/').every(s => s && s !== '.' && s !== '..');
const identity = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.mode}:${s.nlink}`;

// Read-only static verification, NOT execution authorization or a sandbox.
// expectedDigest must be pinned outside the untrusted bundle. No manifest is
// generated/blessed here. Every directory and file must appear in the manifest.
export async function verifyBundle(root, manifest, expectedDigest) {
  try {
    if (typeof root !== 'string' || !isAbsolute(root) || root === '/' || await realpath(root) !== root
      || !/^[a-f0-9]{64}$/.test(expectedDigest) || !Array.isArray(manifest)
      || manifest.length < 1 || manifest.length > 20000) fail();
    const entries = new Map();
    let declaredBytes = 0;
    for (const entry of manifest) {
      if (!entry || !safePath(entry.path) || entries.has(entry.path)) fail();
      if (entry.kind === 'directory') {
        if (Object.keys(entry).sort().join(',') !== 'kind,mode,path' || ![0o700, 0o755].includes(entry.mode)) fail();
      } else if (entry.kind === 'file') {
        if (Object.keys(entry).sort().join(',') !== 'kind,mode,path,sha256,size'
          || ![0o600, 0o644, 0o700, 0o755].includes(entry.mode)
          || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 256 * 1024 * 1024
          || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail();
        declaredBytes += entry.size;
      } else fail();
      entries.set(entry.path, { ...entry });
    }
    if (declaredBytes > 512 * 1024 * 1024) fail();
    const canonical = [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      .map(e => e.kind === 'directory' ? { path: e.path, kind: e.kind, mode: e.mode }
        : { path: e.path, kind: e.kind, mode: e.mode, size: e.size, sha256: e.sha256 });
    if (hash(JSON.stringify(canonical)) !== expectedDigest) fail();
    for (const path of entries.keys()) {
      const parent = dirname(path);
      if (parent !== '.' && entries.get(parent)?.kind !== 'directory') fail();
    }
    const uid = process.getuid();
    for (let p = root; ; p = dirname(p)) {
      const s = await lstat(p);
      const stickyRoot = s.uid === 0 && (s.mode & 0o1000) !== 0;
      if (!s.isDirectory() || s.isSymbolicLink() || ![0, uid].includes(s.uid)
        || ((s.mode & 0o022) && !stickyRoot)) fail();
      if (p === root && (s.uid !== uid || (s.mode & 0o7777) !== 0o700)) fail();
      if (p === dirname(p)) break;
    }
    const observed = new Map();
    let files = 0, bytes = 0;
    async function scan(relative = '', depth = 0) {
      if (depth > 64) fail();
      const dir = join(root, relative), before = await lstat(dir, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) fail();
      const children = await opendir(dir);
      for await (const child of children) {
        const name = child.name;
        const path = relative ? `${relative}/${name}` : name, entry = entries.get(path);
        if (!entry || observed.has(path)) fail();
        const full = join(root, path), stat = await lstat(full, { bigint: true });
        if (stat.uid !== BigInt(uid) || Number(stat.mode & 0o7777n) !== entry.mode) fail();
        observed.set(path, identity(stat));
        if (entry.kind === 'directory') await scan(path, depth + 1);
        else {
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size !== BigInt(entry.size)) fail();
          const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            if (identity(await handle.stat({ bigint: true })) !== identity(stat)) fail();
            const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
            let size = 0;
            while (true) {
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
              if (!bytesRead) break;
              size += bytesRead; if (size > entry.size) fail();
              digest.update(buffer.subarray(0, bytesRead));
            }
            if (size !== entry.size || digest.digest('hex') !== entry.sha256
              || identity(await handle.stat({ bigint: true })) !== identity(stat)) fail();
            files++; bytes += size;
          } finally { await handle.close(); }
        }
      }
      if (identity(await lstat(dir, { bigint: true })) !== identity(before)) fail();
    }
    await scan();
    if (observed.size !== entries.size) fail();
    for (const [path, expected] of observed) if (identity(await lstat(join(root, path), { bigint: true })) !== expected) fail();
    return { verified: true, files, bytes };
  } catch { fail(); }
}
