import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, parse } from 'node:path';

// Admission for a measurement run: establish WHICH artifacts are about to be
// executed, before any of them is.
//
// This is identity, not provenance. A matching digest says the bytes are the
// bytes that were named; it says nothing about where they came from, who built
// them, or whether they are fit to run. AGENTS.md is explicit that a generated
// manifest digest is not provenance, and nothing here may be quoted as if it
// were. Provenance is the class-R record in docs/step2-phase-b-result.md, and
// it is established by process, not by this file.
//
// What it does check, and why each one is here:
//
//   * an absolute path with no NUL and no `..` segment, so the thing admitted
//     is the thing named and cannot be re-pointed by a later resolution;
//   * the path is not a symlink, checked with lstat rather than stat, and every
//     parent up to the root is not a symlink either. Checking only the leaf
//     lets a swapped parent directory change the target after admission;
//   * a regular file owned by this uid, not group- or world-writable, so
//     another local account cannot replace it between admission and execution;
//   * the SHA-256 matches one the caller named in advance. An expected digest
//     that the caller computed from the same file moments earlier is not a
//     check, so the caller must pass a constant.
//
// The window between admission and execution is not closed by any of this. It
// is narrowed and recorded, not eliminated, and the returned record says so.

const failure = (code) => Object.assign(new Error(code), { code });

async function digest(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', () => reject(failure('ADMISSION_UNREADABLE')));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function assertNoSymlinkChain(path) {
  const { root } = parse(path);
  let current = path;
  const seen = new Set();
  while (current !== root && !seen.has(current)) {
    seen.add(current);
    let info;
    try { info = await lstat(current); } catch { throw failure('ADMISSION_UNREADABLE'); }
    if (info.isSymbolicLink()) throw failure('ADMISSION_SYMLINK');
    current = dirname(current);
  }
}

/**
 * @param entries {Array<{ label: string, path: string, sha256: string }>}
 * @returns a frozen record of what was admitted, or throws with a fixed code.
 */
export async function admit(entries, { uid = process.getuid?.() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw failure('ADMISSION_EMPTY');
  const admitted = [];
  const labels = new Set();
  for (const entry of entries) {
    const { label, path, sha256 } = entry ?? {};
    if (typeof label !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(label)) throw failure('ADMISSION_LABEL_INVALID');
    if (labels.has(label)) throw failure('ADMISSION_LABEL_DUPLICATE');
    labels.add(label);
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw failure('ADMISSION_PATH_INVALID');
    if (path.split('/').includes('..')) throw failure('ADMISSION_PATH_INVALID');
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw failure('ADMISSION_DIGEST_INVALID');

    await assertNoSymlinkChain(path);

    let info;
    try { info = await lstat(path); } catch { throw failure('ADMISSION_UNREADABLE'); }
    if (!info.isFile()) throw failure('ADMISSION_NOT_A_FILE');
    if (uid !== undefined && info.uid !== uid) throw failure('ADMISSION_FOREIGN_OWNER');
    // 0o022: group-write or other-write. Either lets someone else swap the file.
    if ((info.mode & 0o022) !== 0) throw failure('ADMISSION_WRITABLE_BY_OTHERS');

    const actual = await digest(path);
    if (actual !== sha256) throw failure('ADMISSION_DIGEST_MISMATCH');

    admitted.push(Object.freeze({
      label,
      path,
      sha256,
      sizeBytes: info.size,
      // Recorded so a later reader can see whether the admitted path was itself
      // reached through a link further up that resolved elsewhere.
      resolved: await realpath(path).catch(() => null),
      inode: info.ino,
      device: info.dev,
    }));
  }
  return Object.freeze({
    admitted: Object.freeze(admitted),
    at: new Date().toISOString(),
    // Never true. Admission is identity, and saying so in the record stops it
    // being cited later as if it were provenance or a fitness judgement.
    provenanceEstablished: false,
    gateMeasurement: false,
    // Stated rather than implied: nothing here prevents the file being replaced
    // between this check and the execution that follows it.
    timeOfCheckToTimeOfUse: 'not closed; admission narrows and records the window, it does not eliminate it',
  });
}
