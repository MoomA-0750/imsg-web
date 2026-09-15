import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The picture a contact card carries, read from the same address book imsg resolves names from.
 *
 * Matching is by the resolved name rather than by handle: imsg has already matched the handle to
 * one of these records — with a phone-number library this app does not have — so the name is the
 * far end of a match that just succeeded. The cost is that a name shared by two contacts is
 * ambiguous, and an ambiguous name is dropped rather than guessed at.
 */
export type ContactPhoto = { bytes: Buffer; type: string };

const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
/** Apple keeps a one-byte prefix in front of the image; the picture starts at its signature. */
const SIGNATURES: readonly { readonly type: string; readonly magic: Buffer }[] = [
  { type: 'image/jpeg', magic: Buffer.from('ffd8ff', 'hex') },
  { type: 'image/png', magic: Buffer.from('89504e470d0a1a0a', 'hex') },
];
const PREFIX_SEARCH = 4;

export function readPhoto(blob: unknown): ContactPhoto | undefined {
  if (!(blob instanceof Uint8Array) || blob.length === 0 || blob.length > PHOTO_MAX_BYTES) return undefined;
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let at = 0; at < PREFIX_SEARCH; at++) {
    for (const { type, magic } of SIGNATURES) {
      if (bytes.length > at + magic.length && bytes.subarray(at, at + magic.length).equals(magic)) {
        return { bytes: Buffer.from(bytes.subarray(at)), type };
      }
    }
  }
  return undefined; // a record can hold a short marker where a picture would be; that is not one
}

/** imsg's own rule, so the names this produces are the names it returns for a conversation. */
export function contactName(nickname: string, first: string, last: string): string {
  return nickname !== '' ? nickname : [first, last].filter(part => part !== '').join(' ');
}

async function databases(directory: string): Promise<string[]> {
  const found: string[] = [];
  const holders = [directory];
  try {
    for (const entry of await readdir(join(directory, 'Sources'), { withFileTypes: true })) {
      if (entry.isDirectory()) holders.push(join(directory, 'Sources', entry.name));
    }
  } catch { /* an address book with no synced accounts has no Sources directory */ }
  for (const holder of holders) {
    // Version 22 only: after an OS migration an older file can linger, and its pictures are stale.
    try { if ((await readdir(holder)).includes('AddressBook-v22.abcddb')) found.push(join(holder, 'AddressBook-v22.abcddb')); }
    catch { /* unreadable source: the others still count */ }
  }
  return found;
}

const QUERY = `
  SELECT COALESCE(ZNICKNAME, '') AS nickname, COALESCE(ZFIRSTNAME, '') AS first, COALESCE(ZLASTNAME, '') AS last,
         COALESCE(ZTHUMBNAILIMAGEDATA, ZIMAGEDATA) AS picture
  FROM ZABCDRECORD
  WHERE ZTHUMBNAILIMAGEDATA IS NOT NULL OR ZIMAGEDATA IS NOT NULL`;

/**
 * Every usable picture, by contact name. Read-only, and a store that cannot be opened — locked,
 * migrated, or not permitted — simply contributes nothing: names still resolve without pictures.
 */
export async function loadContactPhotos(directory: string): Promise<Map<string, ContactPhoto>> {
  const photos = new Map<string, ContactPhoto>();
  const ambiguous = new Set<string>();
  for (const path of await databases(directory)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      for (const row of db.prepare(QUERY).all() as Record<string, unknown>[]) {
        const name = contactName(String(row.nickname ?? ''), String(row.first ?? ''), String(row.last ?? ''));
        if (name === '' || ambiguous.has(name)) continue;
        const photo = readPhoto(row.picture);
        if (!photo) continue;
        // Two contacts under one name: there is no way to tell which conversation is which.
        if (photos.has(name)) { photos.delete(name); ambiguous.add(name); continue; }
        photos.set(name, photo);
      }
    } catch { /* this store contributes nothing */ }
    finally { try { db?.close(); } catch { /* already gone */ } }
  }
  return photos;
}

/** Holds the pictures for a while: the address book changes far more slowly than the UI polls. */
export class ContactPhotos {
  #photos = new Map<string, ContactPhoto>();
  /** Undefined until the first read, which a clock starting at zero must not be mistaken for. */
  #loaded: number | undefined;
  #loading: Promise<void> | undefined;
  constructor(private readonly directory: string, private readonly ttlMs = 600_000, private readonly now = Date.now) {}
  get size() { return this.#photos.size; }
  async refresh(): Promise<void> {
    if (this.#loaded !== undefined && this.now() - this.#loaded < this.ttlMs) return;
    this.#loading ??= loadContactPhotos(this.directory)
      .then(photos => { this.#photos = photos; }, () => { this.#photos = new Map(); })
      .finally(() => { this.#loaded = this.now(); this.#loading = undefined; });
    await this.#loading;
  }
  get(name: string): ContactPhoto | undefined { return this.#photos.get(name); }
}
