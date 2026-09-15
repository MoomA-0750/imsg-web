import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { UploadStore, safeFileName } from '../src/server/uploads.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup(options: { maxBytes?: number; maxPending?: number; ttlMs?: number; now?: () => number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'iw-uploads-')); dirs.push(base);
  return { base, store: new UploadStore({ dir: join(base, 'uploads'), ...options }) };
}
const body = (...chunks: string[]) => Readable.from(chunks.map(chunk => Buffer.from(chunk)));

describe('UploadStore (synthetic)', () => {
  it('keeps the owner filename but strips anything that could escape the directory', () => {
    expect(safeFileName('holiday photo.HEIC')).toBe('holiday photo.HEIC');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a/b\\c.png')).toBe('c.png');
    expect(safeFileName('...hidden')).toBe('hidden');
    expect(safeFileName('')).toBe('attachment');
    expect(safeFileName(undefined)).toBe('attachment');
    expect(safeFileName('写真.jpg')).toBe('写真.jpg');
    expect(safeFileName('x'.repeat(400)).length).toBe(120);
  });
  it('streams to its own directory under the owner filename, and hands back only an opaque id', async () => {
    const { store } = await setup();
    const upload = await store.accept(body('hello ', 'world'), 'note.txt');
    expect(upload.bytes).toBe(11);
    expect(upload.name).toBe('note.txt');
    expect(upload.path.endsWith('/note.txt')).toBe(true);
    expect(upload.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(upload.path, 'utf8')).toBe('hello world');
    expect((await stat(upload.path)).mode & 0o777).toBe(0o600);
  });
  it('refuses anything past the byte ceiling and leaves nothing behind', async () => {
    const { store, base } = await setup({ maxBytes: 8 });
    await expect(store.accept(body('123456789'), 'big.bin')).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE', status: 413 });
    expect(await readdir(join(base, 'uploads'))).toEqual([]);
  });
  it('refuses an empty body', async () => {
    const { store } = await setup();
    await expect(store.accept(body(), 'empty.bin')).rejects.toMatchObject({ code: 'UPLOAD_EMPTY' });
  });
  it('lets a send consume an upload exactly once', async () => {
    const { store } = await setup();
    const upload = await store.accept(body('x'), 'a.txt');
    expect(store.take(upload.id)?.id).toBe(upload.id);
    expect(store.take(upload.id)).toBeUndefined();
    await store.discard(upload);
    await expect(stat(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('bounds how many uploads can wait at once', async () => {
    const { store } = await setup({ maxPending: 2 });
    await store.accept(body('a'), '1.txt');
    await store.accept(body('b'), '2.txt');
    await expect(store.accept(body('c'), '3.txt')).rejects.toMatchObject({ code: 'UPLOAD_LIMIT', status: 429 });
  });
  it('drops uploads that were never sent, and everything on shutdown', async () => {
    let now = 1_000;
    const { store, base } = await setup({ ttlMs: 500, now: () => now });
    const stale = await store.accept(body('old'), 'old.txt');
    now = 2_000;
    const fresh = await store.accept(body('new'), 'new.txt'); // accept() sweeps first
    expect(store.take(stale.id)).toBeUndefined();
    await expect(stat(stale.path)).rejects.toMatchObject({ code: 'ENOENT' });
    // Once taken, the upload belongs to the send, which discards it when finished.
    expect(store.take(fresh.id)?.id).toBe(fresh.id);
    await store.discard(fresh);
    const left = await store.accept(body('never sent'), 'left.txt');
    await store.close(); // shutdown clears whatever is still waiting
    expect(await readdir(join(base, 'uploads'))).toEqual([]);
    await expect(stat(left.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
