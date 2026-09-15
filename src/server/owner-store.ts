import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { credentialValid, hashKey, newToken, type Credential } from './auth.js';
import { WebError } from './web-error.js';

/** Version 2 is the only form written now; version 1 is still read. See `load`. */
const record = (credential: Credential) => JSON.stringify(
  credential.kind === 'token' ? { schemaVersion: 1, keyHash: credential.hash } : { schemaVersion: 2, credential });

export class OwnerStore {
  constructor(readonly directory: string) {
    if (!isAbsolute(directory) || directory.includes('\0')) throw new WebError('STATE_DIR_INVALID');
  }
  async validate(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) throw new WebError('STATE_DIR_UNSAFE');
  }
  async setup(): Promise<string> {
    await mkdir(this.directory, { mode: 0o700 }); // Existing directory is deliberately not silently adopted.
    await this.validate();
    const key = newToken();
    const file = await open(join(this.directory, 'owner.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(record({ kind: 'token', hash: hashKey(key) })); await file.sync(); }
    finally { await file.close(); }
    await this.#syncDir();
    return key;
  }
  async load(): Promise<Credential> {
    await this.validate();
    const file = await open(join(this.directory, 'owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await file.stat();
      if (!s.isFile() || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid?.() || s.size > 1024) throw new WebError('OWNER_UNSAFE');
      const raw: unknown = JSON.parse(await file.readFile('utf8'));
      // Version 1 held the hash of a generated key; version 2 holds a salted password. Both are
      // still read, so upgrading the app does not lock the owner out before they choose a password.
      if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) throw new WebError('OWNER_INVALID');
      const credential: unknown = raw.schemaVersion === 1 && 'keyHash' in raw ? { kind: 'token', hash: raw.keyHash }
        : raw.schemaVersion === 2 && 'credential' in raw ? raw.credential : undefined;
      if (!credentialValid(credential)) throw new WebError('OWNER_INVALID');
      return credential;
    } finally { await file.close(); }
  }
  /** Replaces the stored credential, leaving the previous file untouched if anything fails. */
  async rotate(credential: Credential): Promise<void> {
    await this.validate();
    // Validate the current state before replacing it; never replace a symlink or unsafe owner file.
    await this.load();
    const path = join(this.directory, `.owner-${newToken()}.tmp`);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(record(credential)); await file.sync(); }
    catch (error) { await file.close(); await unlink(path).catch(() => {}); throw error; }
    await file.close();
    try { await rename(path, join(this.directory, 'owner.json')); await this.#syncDir(); }
    catch (error) { await unlink(path).catch(() => {}); throw error; }
  }
  async #syncDir() {
    const dir = await open(this.directory, constants.O_RDONLY);
    try { await dir.sync(); } finally { await dir.close(); }
  }
}
