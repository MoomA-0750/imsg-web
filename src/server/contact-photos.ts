import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The picture a contact card carries, read from the same address book imsg resolves names from.
 *
 * Matching is by the resolved name wherever there is one: imsg has already matched the handle to
 * one of these records — with a phone-number library this app does not have — so the name is the
 * far end of a match that just succeeded. The cost is that a name shared by two contacts is
 * ambiguous, and an ambiguous name is dropped rather than guessed at.
 *
 * A group's members arrive as bare handles, which imsg resolves no names for, so those are matched
 * on the handle itself. That match is this app's own and cruder: see `handleKey`.
 */
export type ContactPhoto = { bytes: Buffer; type: string };
/** Pictures by contact name, and the same pictures by the handles their cards carry. */
export type ContactIndex = { names: Map<string, ContactPhoto>; handles: Map<string, ContactPhoto> };

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

/** How many trailing digits of a number have to agree. Enough that +81 90… and 090… are one number. */
const DIGITS_COMPARED = 9;
/**
 * The form a handle is compared in: an address lowercased, a number reduced to its last few digits
 * so a card written in national form still answers for one Messages holds internationally.
 *
 * It is a blunt rule, and deliberately only used where nothing better exists. Two numbers that end
 * alike collide, so a key claimed by two contacts is dropped rather than shown as either of them.
 */
export function handleKey(handle: string): string | null {
  const value = handle.trim();
  if (value === '') return null;
  if (value.includes('@')) return value.toLowerCase();
  const digits = value.replace(/\D/g, '');
  if (digits === '') return null;
  return digits.length > DIGITS_COMPARED ? digits.slice(-DIGITS_COMPARED) : digits;
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
  SELECT Z_PK AS id, COALESCE(ZNICKNAME, '') AS nickname, COALESCE(ZFIRSTNAME, '') AS first, COALESCE(ZLASTNAME, '') AS last,
         COALESCE(ZTHUMBNAILIMAGEDATA, ZIMAGEDATA) AS picture
  FROM ZABCDRECORD
  WHERE ZTHUMBNAILIMAGEDATA IS NOT NULL OR ZIMAGEDATA IS NOT NULL`;
const HANDLES = `
  SELECT ZOWNER AS owner, ZFULLNUMBER AS handle FROM ZABCDPHONENUMBER WHERE ZFULLNUMBER IS NOT NULL
  UNION ALL
  SELECT ZOWNER AS owner, ZADDRESS AS handle FROM ZABCDEMAILADDRESS WHERE ZADDRESS IS NOT NULL`;

/** Whichever entries a card contributes, keyed as `handleKey` compares them. */
function handlesOf(db: DatabaseSync): Map<number, string[]> {
  const byOwner = new Map<number, string[]>();
  // A store old enough to lack these tables still has names; it simply adds no handles.
  try {
    for (const row of db.prepare(HANDLES).all() as Record<string, unknown>[]) {
      const key = typeof row.handle === 'string' ? handleKey(row.handle) : null;
      if (key === null || typeof row.owner !== 'number') continue;
      byOwner.set(row.owner, [...(byOwner.get(row.owner) ?? []), key]);
    }
  } catch { /* no handle to match on here */ }
  return byOwner;
}

/**
 * Every usable picture, by contact name and by handle. Read-only, and a store that cannot be
 * opened — locked, migrated, or not permitted — simply contributes nothing: names still resolve
 * without pictures.
 */
export async function loadContactPhotos(directory: string): Promise<ContactIndex> {
  const names = new Map<string, ContactPhoto>(), handles = new Map<string, ContactPhoto>();
  const ambiguous = { names: new Set<string>(), handles: new Set<string>() };
  /**
   * One key, one face: a second contact claiming it means neither can be shown for it. The same
   * face claiming it twice is not a second contact — one card can list a number twice, and the
   * same card is held in the local store and in a synced account's.
   */
  const claim = (into: Map<string, ContactPhoto>, taken: Set<string>, key: string, photo: ContactPhoto) => {
    if (taken.has(key)) return;
    const held = into.get(key);
    if (!held) { into.set(key, photo); return; }
    if (held.bytes.equals(photo.bytes)) return;
    into.delete(key);
    taken.add(key);
  };
  for (const path of await databases(directory)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const owned = handlesOf(db);
      for (const row of db.prepare(QUERY).all() as Record<string, unknown>[]) {
        const photo = readPhoto(row.picture);
        if (!photo) continue;
        const name = contactName(String(row.nickname ?? ''), String(row.first ?? ''), String(row.last ?? ''));
        if (name !== '') claim(names, ambiguous.names, name, photo);
        for (const key of owned.get(row.id as number) ?? []) claim(handles, ambiguous.handles, key, photo);
      }
    } catch { /* this store contributes nothing */ }
    finally { try { db?.close(); } catch { /* already gone */ } }
  }
  return { names, handles };
}

/** Holds the pictures for a while: the address book changes far more slowly than the UI polls. */
export class ContactPhotos {
  #photos: ContactIndex = { names: new Map(), handles: new Map() };
  /** Undefined until the first read, which a clock starting at zero must not be mistaken for. */
  #loaded: number | undefined;
  #loading: Promise<void> | undefined;
  constructor(private readonly directory: string, private readonly ttlMs = 600_000, private readonly now = Date.now) {}
  get size() { return this.#photos.names.size; }
  async refresh(): Promise<void> {
    if (this.#loaded !== undefined && this.now() - this.#loaded < this.ttlMs) return;
    this.#loading ??= loadContactPhotos(this.directory)
      .then(photos => { this.#photos = photos; }, () => { this.#photos = { names: new Map(), handles: new Map() }; })
      .finally(() => { this.#loaded = this.now(); this.#loading = undefined; });
    await this.#loading;
  }
  get(name: string): ContactPhoto | undefined { return this.#photos.names.get(name); }
  /** For a group's member, who arrives as a bare handle with no name resolved for them. */
  forHandle(handle: string): ContactPhoto | undefined {
    const key = handleKey(handle);
    return key === null ? undefined : this.#photos.handles.get(key);
  }
}
