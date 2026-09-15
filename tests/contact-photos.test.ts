import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContactPhotos, contactName, handleKey, loadContactPhotos, readPhoto } from '../src/server/contact-photos.js';

const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 9)]);
/** Apple stores the picture one byte in; a record can also hold a short marker that is not one. */
const stored = (image: Buffer) => Buffer.concat([Buffer.from([1]), image]);
const MARKER = Buffer.concat([Buffer.from([2]), Buffer.from('88EA9F41', 'ascii')]);

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Builds address book stores with the columns and layout the real ones have. */
async function addressBook(sources: { nickname?: string; first?: string; last?: string; picture?: Buffer; phones?: string[]; emails?: string[] }[][]) {
  const dir = await mkdtemp(join(tmpdir(), 'iw-ab-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  sources.forEach(() => {});
  for (const [index, records] of sources.entries()) {
    const holder = index === 0 ? dir : join(dir, 'Sources', `source-${index}`);
    await mkdir(holder, { recursive: true });
    const db = new DatabaseSync(join(holder, 'AddressBook-v22.abcddb'));
    db.exec('CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZNICKNAME TEXT, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZTHUMBNAILIMAGEDATA BLOB, ZIMAGEDATA BLOB)');
    db.exec('CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT)');
    db.exec('CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESS TEXT)');
    const insert = db.prepare('INSERT INTO ZABCDRECORD (ZNICKNAME, ZFIRSTNAME, ZLASTNAME, ZTHUMBNAILIMAGEDATA, ZIMAGEDATA) VALUES (?, ?, ?, ?, NULL)');
    const phone = db.prepare('INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (?, ?)');
    const email = db.prepare('INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) VALUES (?, ?)');
    for (const r of records) {
      const owner = insert.run(r.nickname ?? null, r.first ?? null, r.last ?? null, r.picture ?? null).lastInsertRowid;
      for (const number of r.phones ?? []) phone.run(owner, number);
      for (const address of r.emails ?? []) email.run(owner, address);
    }
    db.close();
  }
  return dir;
}

describe('contact pictures (synthetic address book)', () => {
  it('reads a picture past Apple’s leading byte and refuses anything that is not one', () => {
    expect(readPhoto(stored(JPEG))).toEqual({ bytes: JPEG, type: 'image/jpeg' });
    expect(readPhoto(stored(PNG))).toEqual({ bytes: PNG, type: 'image/png' });
    expect(readPhoto(JPEG)).toEqual({ bytes: JPEG, type: 'image/jpeg' }); // no prefix is fine too
    for (const bad of [MARKER, Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from('GIF89a'), undefined, null, 'string']) {
      expect(readPhoto(bad)).toBeUndefined();
    }
  });

  it('builds the same name imsg does, so a resolved conversation name matches a record', () => {
    expect(contactName('', '合成', '太郎')).toBe('合成 太郎');
    expect(contactName('あだ名', '合成', '太郎')).toBe('あだ名'); // a nickname wins outright
    expect(contactName('', '', '姓のみ')).toBe('姓のみ');
    expect(contactName('', '', '')).toBe('');
  });

  it('collects pictures across every source and drops a name two contacts share', async () => {
    const dir = await addressBook([
      [{ first: '本体', last: '連絡先', picture: stored(PNG) }],
      [{ first: '合成', last: '太郎', picture: stored(JPEG) },
       { first: '名前なし', last: '', picture: MARKER },       // not a picture
       { first: '', last: '', picture: stored(JPEG) },          // no name to match on
       { nickname: '重複', picture: stored(JPEG) }],
      [{ nickname: '重複', picture: stored(PNG) }],             // the same name, a different face
    ]);
    const photos = await loadContactPhotos(dir);
    expect([...photos.names.keys()].sort()).toEqual(['合成 太郎', '本体 連絡先']);
    expect(photos.names.get('合成 太郎')).toEqual({ bytes: JPEG, type: 'image/jpeg' });
    expect(photos.names.get('重複')).toBeUndefined();
  });

  it('compares a number by its last digits and an address by its letters', () => {
    expect(handleKey('+81 90-1234-5678')).toBe(handleKey('09012345678')); // one number, two ways of writing it
    expect(handleKey('SOMEONE@Example.invalid')).toBe('someone@example.invalid');
    expect(handleKey('0312345678')).not.toBe(handleKey('0987654321'));
    expect(handleKey('7654321')).toBe('7654321'); // short enough to stand as it is
    for (const empty of ['', '   ', '+-()']) expect(handleKey(empty)).toBeNull();
  });

  it('finds a picture by the handles a card carries, and refuses one two contacts could claim', async () => {
    const dir = await addressBook([
      [{ first: '合成', last: '太郎', picture: stored(JPEG), phones: ['+81 90-1234-5678', '090-1234-5678'], emails: ['Taro@Example.invalid'] },
       { first: '別の', last: '人', picture: stored(PNG), phones: ['03-1111-2222'] },
       { first: 'そっくり', last: '番号', picture: stored(JPEG), phones: ['+81 3 1111 2222'] }],        // ends the same
      [{ first: '合成', last: '太郎', picture: stored(JPEG), phones: ['09012345678'] }],                 // the same card, synced
      [{ first: '写真なし', last: '連絡先', phones: ['08000000000'] }],
    ]);
    const photos = new ContactPhotos(dir);
    await photos.refresh();
    // The card lists its number twice and appears in two stores; that is still one person.
    expect(photos.forHandle('+819012345678')).toEqual({ bytes: JPEG, type: 'image/jpeg' });
    expect(photos.forHandle('taro@example.invalid')).toEqual({ bytes: JPEG, type: 'image/jpeg' });
    expect(photos.forHandle('+81311112222')).toBeUndefined();    // two contacts end alike: neither is shown
    expect(photos.forHandle('+818000000000')).toBeUndefined();   // a real contact, with no picture to give
    expect(photos.forHandle('')).toBeUndefined();
  });

  it('treats an unreadable address book as simply having no pictures', async () => {
    expect((await loadContactPhotos(join(tmpdir(), 'iw-ab-absent'))).names.size).toBe(0);
    const dir = await mkdtemp(join(tmpdir(), 'iw-ab-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, 'AddressBook-v22.abcddb'), 'not a database');
    expect((await loadContactPhotos(dir)).names.size).toBe(0);
    // An older store left behind by a migration is not read at all.
    const old = await mkdtemp(join(tmpdir(), 'iw-ab-'));
    cleanups.push(() => rm(old, { recursive: true, force: true }));
    await writeFile(join(old, 'AddressBook-v21.abcddb'), 'older');
    expect((await loadContactPhotos(old)).names.size).toBe(0);
  });

  it('holds what it read until the time is up, then reads again', async () => {
    const dir = await addressBook([[{ first: '合成', last: '太郎', picture: stored(JPEG) }]]);
    let now = 1_000;
    const photos = new ContactPhotos(dir, 600_000, () => now);
    await photos.refresh();
    expect(photos.get('合成 太郎')).toBeDefined();
    await rm(join(dir, 'AddressBook-v22.abcddb'));
    await photos.refresh();
    expect(photos.get('合成 太郎')).toBeDefined(); // still held
    now += 600_000;
    await photos.refresh();
    expect(photos.get('合成 太郎')).toBeUndefined();
    expect(photos.size).toBe(0);
  });
});
