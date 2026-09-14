import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { accepts, openAttachment, prepareAttachment } from '../src/server/attachments.js';
import { ImageConverter } from '../src/server/image-convert.js';
import { buildChildEnv } from '../src/server/child-env.js';

const SIPS = fileURLToPath(new URL('./fixtures/fake-sips.sh', import.meta.url));
const HEIC = (marker: string) => Buffer.concat([Buffer.from('000000186674797068656963', 'hex'), Buffer.from(` synthetic ${marker}`)]);
const CHROME = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const SAFARI = 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });

const PREVIEW = (marker: string) => Buffer.concat([Buffer.from('AAPL\r\n\x1a\n', 'latin1'), Buffer.from(` synthetic preview ${marker}`)]);

async function setup(options: { timeoutMs?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'iw-convert-')); cleanups.push(base);
  const root = join(base, 'Attachments'), tmp = join(base, 'child-tmp');
  await mkdir(root); await mkdir(tmp, { mode: 0o700 });
  await chmod(SIPS, 0o755);
  const converter = new ImageConverter({ sips: SIPS, context: buildChildEnv({ tmpDir: tmp, cwd: tmp, home: base }), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  const file = async (name: string, body: Buffer) => { await writeFile(join(root, name), body); return join(root, name); };
  const serve = async (path: string, accept: string | undefined, type = 'image/heic') => {
    const served = await openAttachment(root, path, type, { converter, accept });
    return { type: served.type, body: Buffer.concat(await served.stream.toArray()) };
  };
  const calls = async () => (await readFile(join(tmp, 'calls'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const leftovers = async () => (await readdir(tmp)).filter(name => name !== 'calls');
  return { root, converter, file, serve, calls, leftovers };
}

describe('HEIC, JPEG XL and thumbnail conversion to JPEG (synthetic sips)', () => {
  it('reads Accept exactly: named types with nonzero quality only, never wildcards', () => {
    expect(accepts(CHROME, 'image/avif')).toBe(true);
    expect(accepts(CHROME, 'image/heic')).toBe(false);
    expect(accepts(SAFARI, 'image/heic')).toBe(true);
    expect(accepts('image/webp;q=0, image/*', 'image/webp')).toBe(false);
    expect(accepts(undefined, 'image/webp')).toBe(false);
  });
  it('converts to JPEG for a browser that cannot draw HEIC, shrinks only large images, and leaves no files', async () => {
    const f = await setup();
    const small = await f.file('small.heic', HEIC('small')), big = await f.file('big.heic', HEIC('BIG'));
    const jpeg = await f.serve(big, CHROME);
    expect(jpeg.type).toBe('image/jpeg'); expect(jpeg.body.toString('latin1')).toContain('resample=2048');
    expect((await f.serve(small, undefined)).body.toString('latin1')).toContain('resample=none');
    const conversions = (await f.calls()).filter(call => call.startsWith('sips -s format'));
    expect(conversions).toHaveLength(2);
    expect(conversions[0]).toContain('format jpeg -Z 2048'); expect(conversions[1]).not.toContain('-Z');
    // sips was given only copies inside the private directory, never a path in Attachments.
    expect((await f.calls()).some(call => call.includes('Attachments'))).toBe(false);
    expect(await f.leftovers()).toEqual([]);
  });
  it('passes the original through to a browser that accepts HEIC, without running anything', async () => {
    const f = await setup();
    const served = await f.serve(await f.file('a.heic', HEIC('safari')), SAFARI);
    expect(served.type).toBe('image/heic'); expect(served.body.equals(HEIC('safari'))).toBe(true);
    expect(await f.calls()).toEqual([]);
  });
  it('judges success by output bytes: a failed conversion sends the original', async () => {
    const f = await setup();
    const original = await f.serve(await f.file('d.heic', HEIC('NOjpeg')), CHROME);
    expect(original.type).toBe('image/heic'); expect(original.body.equals(HEIC('NOjpeg'))).toBe(true);
    expect(await f.leftovers()).toEqual([]);
  });
  it('serves a Messages thumbnail only converted, never as the original, and only if its bytes are a preview', async () => {
    const f = await setup();
    const thumb = await f.file('IMG-preview.ktx', PREVIEW('ok'));
    const served = await f.serve(thumb, CHROME, 'image/x-apple-preview');
    expect(served.type).toBe('image/jpeg');
    expect((await f.calls()).some(call => call.includes('in.ktx'))).toBe(true);
    // Even a browser that claims to accept the preview type gets JPEG.
    expect((await f.serve(thumb, 'image/x-apple-preview', 'image/x-apple-preview')).type).toBe('image/jpeg');
    await expect(f.serve(await f.file('broken-preview.ktx', PREVIEW('NOjpeg')), CHROME, 'image/x-apple-preview')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE', status: 404 });
    await expect(f.serve(await f.file('fake-preview.ktx', HEIC('not a preview')), CHROME, 'image/x-apple-preview')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
    await expect(f.serve(thumb, CHROME, 'image/heic')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
    await expect(openAttachment(join(tmpdir(), 'unused'), thumb, 'image/x-apple-preview')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
  });
  it('kills a converter that hangs and serves the original', async () => {
    const f = await setup({ timeoutMs: 300 });
    expect((await f.serve(await f.file('e.heic', HEIC('HANG')), CHROME)).type).toBe('image/heic');
    expect(await f.leftovers()).toEqual([]);
  }, 10_000);
  it('prepares ahead in the background so the view reuses it, and skips files that changed or are not images', async () => {
    const f = await setup();
    const path = await f.file('f.heic', HEIC('ahead'));
    await prepareAttachment(f.root, path, 'image/heic', f.converter);
    const count = (await f.calls()).length;
    expect(count).toBeGreaterThan(0);
    const viewed = await f.serve(path, CHROME);
    expect(viewed.type).toBe('image/jpeg'); expect((await f.calls()).length).toBe(count);
    await prepareAttachment(f.root, path, 'image/heic', f.converter); // already done: nothing runs
    expect((await f.calls()).length).toBe(count);
    await prepareAttachment(f.root, await f.file('g.jpg', Buffer.from('<!DOCTYPE html>')), 'image/heic', f.converter);
    await prepareAttachment(f.root, join(f.root, '..', 'outside.heic'), 'image/heic', f.converter);
    expect((await f.calls()).length).toBe(count);
  });
  it('lets a view go ahead of queued background work', async () => {
    const f = await setup();
    const background = await Promise.all(['1', '2', '3'].map(n => f.file(`slow${n}.heic`, HEIC(`SLOW ${n}`))));
    const preparing = Promise.all(background.map(path => prepareAttachment(f.root, path, 'image/heic', f.converter)));
    await vi.waitFor(async () => expect((await f.calls()).length).toBeGreaterThan(0));
    const view = await f.file('view.heic', HEIC('view'));
    await f.serve(view, CHROME);
    const order = (await f.calls()).filter(call => call.startsWith('sips -s format'));
    // The view finished while at most one background conversion had.
    expect(order.length).toBeLessThanOrEqual(2);
    await preparing;
    expect((await f.calls()).filter(call => call.startsWith('sips -s format'))).toHaveLength(4);
  }, 15_000);
});
