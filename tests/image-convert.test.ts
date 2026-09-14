import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { accepts, openAttachment } from '../src/server/attachments.js';
import { ImageConverter } from '../src/server/image-convert.js';
import { buildChildEnv } from '../src/server/child-env.js';

const SIPS = fileURLToPath(new URL('./fixtures/fake-sips.sh', import.meta.url));
const HEIC = (marker: string) => Buffer.concat([Buffer.from('000000186674797068656963', 'hex'), Buffer.from(` synthetic ${marker}`)]);
const CHROME = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const FIREFOX_WITHOUT_AVIF = 'image/webp,*/*';
const SAFARI = 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function setup(options: { timeoutMs?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'iw-convert-')); cleanups.push(base);
  const root = join(base, 'Attachments'), tmp = join(base, 'child-tmp');
  await mkdir(root); await mkdir(tmp, { mode: 0o700 });
  await chmod(SIPS, 0o755);
  const converter = new ImageConverter({ executable: SIPS, context: buildChildEnv({ tmpDir: tmp, cwd: tmp, home: base }), ...options });
  const file = async (name: string, body: Buffer) => { await writeFile(join(root, name), body); return join(root, name); };
  const serve = async (path: string, accept: string | undefined) => {
    const served = await openAttachment(root, path, 'image/heic', { converter, accept });
    return { type: served.type, body: Buffer.concat(await served.stream.toArray()) };
  };
  const calls = async () => (await readFile(join(tmp, 'calls'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const leftovers = async () => (await readdir(tmp)).filter(name => name !== 'calls');
  return { converter, file, serve, calls, leftovers };
}

describe('HEIC and JPEG XL conversion (synthetic sips)', () => {
  it('reads Accept exactly: named types with nonzero quality only, never wildcards', () => {
    expect(accepts(CHROME, 'image/avif')).toBe(true);
    expect(accepts(CHROME, 'image/heic')).toBe(false);
    expect(accepts(SAFARI, 'image/heic')).toBe(true);
    expect(accepts('image/avif;q=0, image/*', 'image/avif')).toBe(false);
    expect(accepts(undefined, 'image/avif')).toBe(false);
  });
  it('sends AVIF to a browser that accepts it and JPEG otherwise, shrinking only large images, and leaves no files', async () => {
    const f = await setup();
    const small = await f.file('small.heic', HEIC('small')), big = await f.file('big.heic', HEIC('BIG'));
    const avif = await f.serve(small, CHROME);
    expect(avif.type).toBe('image/avif'); expect(avif.body.toString('latin1')).toContain('resample=none');
    const jpeg = await f.serve(big, FIREFOX_WITHOUT_AVIF);
    expect(jpeg.type).toBe('image/jpeg'); expect(jpeg.body.toString('latin1')).toContain('resample=2048');
    // sips was given only a copy inside the private directory, never the path in Attachments.
    expect((await f.calls()).some(call => call.includes('Attachments'))).toBe(false);
    expect(await f.leftovers()).toEqual([]);
  });
  it('passes the original through to a browser that accepts HEIC, without running sips', async () => {
    const f = await setup();
    const path = await f.file('a.heic', HEIC('safari'));
    const served = await f.serve(path, SAFARI);
    expect(served.type).toBe('image/heic'); expect(served.body.equals(HEIC('safari'))).toBe(true);
    expect(await f.calls()).toEqual([]);
  });
  it('judges success by output bytes: falls back to JPEG, then to the original', async () => {
    const f = await setup();
    const noAvif = await f.file('b.heic', HEIC('NOavif'));
    expect((await f.serve(noAvif, CHROME)).type).toBe('image/jpeg');
    const neither = await f.file('c.heic', HEIC('NOavif NOjpeg'));
    const original = await f.serve(neither, CHROME);
    expect(original.type).toBe('image/heic'); expect(original.body.equals(HEIC('NOavif NOjpeg'))).toBe(true);
    expect(await f.leftovers()).toEqual([]);
  });
  it('reuses a finished conversion for the same file', async () => {
    const f = await setup();
    const path = await f.file('d.heic', HEIC('cache'));
    await f.serve(path, CHROME); const count = (await f.calls()).length;
    await Promise.all([f.serve(path, CHROME), f.serve(path, CHROME)]);
    expect((await f.calls()).length).toBe(count);
  });
  it('kills a converter that hangs and serves the original', async () => {
    const f = await setup({ timeoutMs: 300 });
    const path = await f.file('e.heic', HEIC('HANG'));
    expect((await f.serve(path, CHROME)).type).toBe('image/heic');
    expect(await f.leftovers()).toEqual([]);
  }, 10_000);
});
