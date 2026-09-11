import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, link, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyBundle } from './nonlaunch-bundle.mjs';
import { inventoryBundle } from './inventory-bundle.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const digest = manifest => hash(JSON.stringify([...manifest].sort((a, b) => a.path < b.path ? -1 : 1)));
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'iw-bundle-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  await mkdir(join(root, 'app'), { mode: 0o700 });
  await writeFile(join(root, 'app', 'entry.mjs'), 'SYNTHETIC', { mode: 0o600 });
  await writeFile(join(root, 'node'), 'SYNTHETIC_NODE', { mode: 0o700 });
  const manifest = [
    { path: 'app', kind: 'directory', mode: 0o700 },
    { path: 'app/entry.mjs', kind: 'file', mode: 0o600, size: 9, sha256: hash('SYNTHETIC') },
    { path: 'node', kind: 'file', mode: 0o700, size: 14, sha256: hash('SYNTHETIC_NODE') },
  ];
  return { root, manifest, pinned: digest(manifest) };
}
const rejected = promise => assert.rejects(promise, e => e.message === 'BUNDLE_REJECTED');

test('verifies every file including executable mode against externally pinned manifest', async t => {
  const f = await fixture(t);
  assert.deepEqual(await verifyBundle(f.root, f.manifest, f.pinned), { verified: true, files: 2, bytes: 23 });
  assert.deepEqual(await verifyBundle(f.root, [...f.manifest].reverse(), f.pinned), { verified: true, files: 2, bytes: 23 });
});

test('rejects changed content, executable permissions, absent files and extra files/directories', async t => {
  for (const change of [
    f => writeFile(join(f.root, 'app/entry.mjs'), 'DIFFERENT'),
    f => chmod(join(f.root, 'node'), 0o600),
    f => rename(join(f.root, 'node'), join(f.root, 'renamed')),
    f => writeFile(join(f.root, 'unlisted'), 'SYNTHETIC'),
    f => mkdir(join(f.root, 'unlisted')),
  ]) {
    const f = await fixture(t); await change(f);
    await rejected(verifyBundle(f.root, f.manifest, f.pinned));
  }
});

test('rejects symlink roots/files/directories and hardlinked files', async t => {
  for (const kind of ['root', 'file', 'directory', 'hardlink']) {
    const f = await fixture(t);
    if (kind === 'root') {
      const alias = `${f.root}-alias`; await symlink(f.root, alias);
      t.after(() => rm(alias));
      await rejected(verifyBundle(alias, f.manifest, f.pinned)); continue;
    }
    if (kind === 'hardlink') {
      const alias = `${f.root}-hardlink`; await link(join(f.root, 'node'), alias);
      t.after(() => rm(alias));
    }
    else {
      const path = join(f.root, kind === 'file' ? 'node' : 'app');
      await rename(path, `${path}-original`); await symlink(`${path}-original`, path);
    }
    await rejected(verifyBundle(f.root, f.manifest, f.pinned));
  }
});

test('a rewritten manifest cannot approve changed content without changing the trusted pin', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'app/entry.mjs'), 'DIFFERENT');
  f.manifest[1].sha256 = hash('DIFFERENT');
  await rejected(verifyBundle(f.root, f.manifest, f.pinned));
});

test('rejects unsafe/duplicate paths, missing parent entries, extra fields and excessive size', async t => {
  const f = await fixture(t);
  for (const manifest of [
    [...f.manifest, f.manifest[0]],
    f.manifest.slice(1),
    [{ ...f.manifest[1], path: '../escape' }],
    [{ ...f.manifest[1], path: '/absolute' }],
    [{ ...f.manifest[1], path: 'a\\b' }],
    [{ ...f.manifest[2], extra: 'SYNTHETIC' }],
    [{ ...f.manifest[2], size: 256 * 1024 * 1024 + 1 }],
  ]) await rejected(verifyBundle(f.root, manifest, digest(manifest)));
});

test('requires private root and rejects writable bundle directories', async t => {
  const f = await fixture(t);
  await chmod(f.root, 0o755);
  await rejected(verifyBundle(f.root, f.manifest, f.pinned));
  await chmod(f.root, 0o700); await chmod(join(f.root, 'app'), 0o777);
  await rejected(verifyBundle(f.root, f.manifest, f.pinned));
});

test('inventory produces canonical review material, not independent approval', async t => {
  const f = await fixture(t), inventory = await inventoryBundle(f.root);
  assert.equal(inventory.approved, false);
  assert.deepEqual(inventory.manifest, f.manifest);
  assert.equal(inventory.digest, f.pinned);
  assert.equal((await verifyBundle(f.root, inventory.manifest, f.pinned)).verified, true);
});

test('inventory rejects links instead of silently following packaging shims', async t => {
  const f = await fixture(t);
  await symlink(join(f.root, 'node'), join(f.root, 'shim'));
  await assert.rejects(inventoryBundle(f.root), e => e.message === 'INVENTORY_REJECTED');
});
