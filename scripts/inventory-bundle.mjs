import { lstat, opendir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Produces an UNAPPROVED packaging inventory. Its digest is not an independent
// trust pin. Review/provenance must establish the pin before any live admission.
export async function inventoryBundle(root) {
  const manifest = [];
  let total = 0;
  async function walk(relative = '', depth = 0) {
    if (depth > 64) throw new Error('INVENTORY_REJECTED');
    const directory = join(root, relative);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVENTORY_REJECTED');
    for await (const child of await opendir(directory)) {
      const path = relative ? `${relative}/${child.name}` : child.name;
      const full = join(root, path), info = await lstat(full);
      if (manifest.length >= 20000 || info.isSymbolicLink()) throw new Error('INVENTORY_REJECTED');
      const mode = info.mode & 0o7777;
      if (info.isDirectory()) {
        manifest.push({ path, kind: 'directory', mode }); await walk(path, depth + 1);
      } else {
        if (!info.isFile() || info.nlink !== 1 || info.size > 256 * 1024 * 1024) throw new Error('INVENTORY_REJECTED');
        total += info.size;
        if (total > 512 * 1024 * 1024) throw new Error('INVENTORY_REJECTED');
        const sha256 = createHash('sha256').update(await readFile(full)).digest('hex');
        manifest.push({ path, kind: 'file', mode, size: info.size, sha256 });
      }
    }
  }
  try {
    await walk();
    manifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    return { manifest, digest, approved: false };
  } catch { throw new Error('INVENTORY_REJECTED'); }
}
