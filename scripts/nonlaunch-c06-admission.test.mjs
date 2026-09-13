// Admission decides which bytes are about to be executed. Every refusal below
// is exercised against a real file on disk, because a refusal that has never
// been seen to fire is a guess about a refusal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admit } from './nonlaunch-c06-admission.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const ZERO = '0'.repeat(64);

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'admission-test-'));
  const file = join(dir, 'artifact');
  writeFileSync(file, 'contents', { mode: 0o700 });
  return { dir, file, digest: sha('contents'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function refused(entries, code, options) {
  await assert.rejects(() => admit(entries, options), (e) => {
    assert.equal(e.code, code, `expected ${code}, got ${e.code}`);
    return true;
  });
}

test('admits a private regular file whose digest matches', async () => {
  const s = scratch();
  try {
    const record = await admit([{ label: 'imsg', path: s.file, sha256: s.digest }]);
    assert.equal(record.admitted.length, 1);
    assert.equal(record.admitted[0].sha256, s.digest);
    assert.equal(record.admitted[0].sizeBytes, 8);
    assert.equal(Object.isFrozen(record), true);
    // The record must keep saying what it is not.
    assert.equal(record.provenanceEstablished, false);
    assert.equal(record.gateMeasurement, false);
    assert.match(record.timeOfCheckToTimeOfUse, /not closed/);
  } finally { s.cleanup(); }
});

test('refuses a digest that does not match the bytes', async () => {
  const s = scratch();
  try {
    await refused([{ label: 'imsg', path: s.file, sha256: ZERO }], 'ADMISSION_DIGEST_MISMATCH');
  } finally { s.cleanup(); }
});

test('refuses a symlink at the leaf, which lstat catches and stat would not', async () => {
  const s = scratch();
  try {
    const link = join(s.dir, 'link');
    symlinkSync(s.file, link);
    await refused([{ label: 'imsg', path: link, sha256: s.digest }], 'ADMISSION_SYMLINK');
  } finally { s.cleanup(); }
});

test('refuses a symlink in a PARENT directory, not only at the leaf', async () => {
  // Checking only the leaf leaves the target swappable by replacing a parent.
  const s = scratch();
  try {
    const real = join(s.dir, 'real');
    mkdirSync(real);
    const nested = join(real, 'artifact');
    writeFileSync(nested, 'contents', { mode: 0o700 });
    const linkedParent = join(s.dir, 'via');
    symlinkSync(real, linkedParent);
    await refused([{ label: 'imsg', path: join(linkedParent, 'artifact'), sha256: s.digest }],
      'ADMISSION_SYMLINK');
  } finally { s.cleanup(); }
});

test('refuses a file another local account could replace', async () => {
  const s = scratch();
  try {
    chmodSync(s.file, 0o766);
    await refused([{ label: 'imsg', path: s.file, sha256: s.digest }], 'ADMISSION_WRITABLE_BY_OTHERS');
    chmodSync(s.file, 0o720);
    await refused([{ label: 'imsg', path: s.file, sha256: s.digest }], 'ADMISSION_WRITABLE_BY_OTHERS');
  } finally { s.cleanup(); }
});

test('refuses a file owned by someone else', async () => {
  const s = scratch();
  try {
    await refused([{ label: 'imsg', path: s.file, sha256: s.digest }], 'ADMISSION_FOREIGN_OWNER',
      { uid: -1 });
  } finally { s.cleanup(); }
});

test('refuses a directory', async () => {
  const s = scratch();
  try {
    await refused([{ label: 'imsg', path: s.dir, sha256: s.digest }], 'ADMISSION_NOT_A_FILE');
  } finally { s.cleanup(); }
});

test('refuses a path that does not exist', async () => {
  const s = scratch();
  try {
    await refused([{ label: 'imsg', path: join(s.dir, 'absent'), sha256: s.digest }], 'ADMISSION_UNREADABLE');
  } finally { s.cleanup(); }
});

for (const [name, entry, code] of [
  ['a relative path', { label: 'imsg', path: 'artifact', sha256: ZERO }, 'ADMISSION_PATH_INVALID'],
  ['a path containing ..', { label: 'imsg', path: '/a/../b', sha256: ZERO }, 'ADMISSION_PATH_INVALID'],
  ['a path with a NUL', { label: 'imsg', path: '/a\0b', sha256: ZERO }, 'ADMISSION_PATH_INVALID'],
  ['a short digest', { label: 'imsg', path: '/a', sha256: 'abc' }, 'ADMISSION_DIGEST_INVALID'],
  // Not ZERO.toUpperCase(): the uppercase of sixty-four zeros is sixty-four
  // zeros, so that spelling tested nothing and failed for another reason.
  ['an uppercase digest', { label: 'imsg', path: '/a', sha256: 'A'.repeat(64) }, 'ADMISSION_DIGEST_INVALID'],
  ['a digest with a non-hex character', { label: 'imsg', path: '/a', sha256: `g${'0'.repeat(63)}` }, 'ADMISSION_DIGEST_INVALID'],
  ['a label with a slash', { label: 'a/b', path: '/a', sha256: ZERO }, 'ADMISSION_LABEL_INVALID'],
]) {
  test(`refuses ${name}`, async () => { await refused([entry], code); });
}

test('refuses an empty entry list, which would admit nothing and look like success', async () => {
  await refused([], 'ADMISSION_EMPTY');
  await refused(undefined, 'ADMISSION_EMPTY');
});

test('refuses two entries sharing a label', async () => {
  const s = scratch();
  try {
    await refused([
      { label: 'imsg', path: s.file, sha256: s.digest },
      { label: 'imsg', path: s.file, sha256: s.digest },
    ], 'ADMISSION_LABEL_DUPLICATE');
  } finally { s.cleanup(); }
});

test('admits several artifacts together and keeps each one distinct', async () => {
  const s = scratch();
  try {
    const second = join(s.dir, 'node');
    writeFileSync(second, 'runtime', { mode: 0o700 });
    const record = await admit([
      { label: 'imsg', path: s.file, sha256: s.digest },
      { label: 'node', path: second, sha256: sha('runtime') },
    ]);
    assert.deepEqual(record.admitted.map((a) => a.label), ['imsg', 'node']);
    assert.notEqual(record.admitted[0].inode, record.admitted[1].inode);
  } finally { s.cleanup(); }
});
