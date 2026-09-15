import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openAudio, sniffAudio } from '../src/server/attachments.js';
import { AudioConverter } from '../src/server/audio-convert.js';
import { buildChildEnv } from '../src/server/child-env.js';
import { UploadStore } from '../src/server/uploads.js';
import { Readable } from 'node:stream';

const AFCONVERT = fileURLToPath(new URL('./fixtures/fake-afconvert.sh', import.meta.url));
/** A CAF is what a voice message is; the marker tells the stand-in tool what to make of it. */
const CAF = (marker: string) => Buffer.concat([Buffer.from('caff\x00\x01\x00\x00', 'latin1'), Buffer.from(` synthetic ${marker}`)]);
const M4A = Buffer.concat([Buffer.from('\0\0\0\x1cftypM4A ', 'latin1'), Buffer.from(' synthetic SOUND')]);
const WAV = (marker: string) => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVEfmt ', 'latin1'), Buffer.from(` synthetic ${marker}`)]);
const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function setup(options: { timeoutMs?: number } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'iw-audio-')); cleanups.push(base);
  const root = join(base, 'Attachments'), tmp = join(base, 'child-tmp');
  await mkdir(root); await mkdir(tmp, { mode: 0o700 });
  await chmod(AFCONVERT, 0o755);
  const context = buildChildEnv({ tmpDir: tmp, cwd: tmp, home: base });
  const converter = new AudioConverter({ afconvert: AFCONVERT, context, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  const file = async (name: string, body: Buffer) => { await writeFile(join(root, name), body); return join(root, name); };
  // null, not undefined: a default parameter would quietly hand the converter back.
  const serve = async (path: string, type: string, using: AudioConverter | null = converter) => {
    const served = await openAudio(root, path, type, using ?? undefined);
    return { type: served.type, body: Buffer.concat(await served.stream.toArray()) };
  };
  const calls = async () => (await readFile(join(tmp, 'calls'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { base, root, tmp, converter, context, file, serve, calls };
}

describe('voice messages and recordings (synthetic afconvert)', () => {
  it('knows audio by its bytes, and does not mistake anything else for it', () => {
    expect(sniffAudio(CAF('x'))).toBe('audio/x-caf');
    expect(sniffAudio(WAV('x'))).toBe('audio/wav');
    expect(sniffAudio(M4A)).toBe('audio/mp4');
    expect(sniffAudio(Buffer.from('#!AMR\n123456789012'))).toBe('audio/amr');
    expect(sniffAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]))).toBe('audio/mpeg');
    for (const other of [Buffer.from('<html> not audio at all '), Buffer.from('\xff\xd8\xff synthetic jpeg', 'latin1'), Buffer.alloc(16)]) {
      expect(sniffAudio(other)).toBeUndefined();
    }
  });

  it('converts a voice message to AAC, once, however many times it is played', async () => {
    const f = await setup();
    const path = await f.file('message.caf', CAF('SOUNDA'));
    const first = await f.serve(path, 'audio/x-caf');
    expect(first.type).toBe('audio/mp4');
    expect(first.body.subarray(4, 12).toString('latin1')).toBe('ftypM4A ');
    expect(first.body.toString('latin1')).toContain('SOUNDA'); // the same recording, not another
    const again = await f.serve(path, 'audio/x-caf');
    expect(again.body).toEqual(first.body);
    expect(await f.calls()).toHaveLength(1); // the second play was already in hand
  });

  it('passes through audio a browser already plays, without running anything', async () => {
    const f = await setup();
    const served = await f.serve(await f.file('note.m4a', M4A), 'audio/mp4');
    expect(served.type).toBe('audio/mp4');
    expect(served.body).toEqual(M4A);
    expect(await f.calls()).toEqual([]);
  });

  it('serves the original when there is nothing to convert with, or when converting fails', async () => {
    const f = await setup();
    const path = await f.file('message.caf', CAF('SOUNDB'));
    // No converter: an Apple browser can still play it, and saying nothing helps no one.
    const without = await f.serve(path, 'audio/x-caf', null);
    expect(without.type).toBe('audio/x-caf');
    // A file the tool refuses: the same answer, rather than a bubble that fails silently.
    const broken = await f.file('broken.caf', CAF('NOISE'));
    const failed = await f.serve(broken, 'audio/x-caf');
    expect(failed.type).toBe('audio/x-caf');
    expect(failed.body).toEqual(CAF('NOISE'));
  });

  it('refuses a file whose bytes are not the audio it was called, and one outside the root', async () => {
    const f = await setup();
    const impostor = await f.file('message.caf', Buffer.from('<svg onload=alert(1)> pretending to be audio'));
    await expect(f.serve(impostor, 'audio/x-caf')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE', status: 404 });
    // An image is not served by the audio route even though both are real media.
    const image = await f.file('picture.jpg', Buffer.from('\xff\xd8\xff synthetic jpeg', 'latin1'));
    await expect(f.serve(image, 'image/jpeg')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
    await expect(f.serve(join(f.base, 'elsewhere.caf'), 'audio/x-caf')).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
  });

  it('kills a conversion that hangs and serves the original', async () => {
    const f = await setup({ timeoutMs: 40 });
    const served = await f.serve(await f.file('slow.caf', CAF('SOUND HANG')), 'audio/x-caf');
    expect(served.type).toBe('audio/x-caf');
  });

  it('re-encodes a recording on the way in, keeping its name, and leaves anything else alone', async () => {
    const f = await setup();
    const dir = join(f.base, 'uploads');
    const store = new UploadStore({ dir, audio: f.converter });
    const recording = await store.accept(Readable.from([WAV('SOUNDC')]), 'ボイスメッセージ.wav', true);
    expect(recording.name).toBe('ボイスメッセージ.m4a'); // what the other end will see
    expect(recording.path.endsWith('ボイスメッセージ.m4a')).toBe(true);
    expect(await readFile(recording.path)).toEqual(Buffer.concat([Buffer.from('\0\0\0\x1cftypM4A ', 'latin1'), Buffer.from('SOUNDC\n')]));
    expect(recording.bytes).toBe((await readFile(recording.path)).length);
    // The PCM it arrived as does not linger beside it.
    await expect(readFile(join(recording.dir, 'ボイスメッセージ.wav'))).rejects.toMatchObject({ code: 'ENOENT' });

    // A file the owner attached is staged exactly as it is, whatever it happens to be.
    const attached = await store.accept(Readable.from([WAV('SOUNDD')]), 'recording.wav');
    expect(attached.name).toBe('recording.wav');
    expect(await readFile(attached.path)).toEqual(WAV('SOUNDD'));
    await store.close();
  });

  it('sends the recording as it is when it cannot be re-encoded', async () => {
    const f = await setup();
    const store = new UploadStore({ dir: join(f.base, 'uploads-2'), audio: f.converter });
    // Nothing the tool will read: the upload still stands, because PCM is sendable, just larger.
    const upload = await store.accept(Readable.from([Buffer.from('not audio at all, really')]), 'ボイスメッセージ.wav', true);
    expect(upload.name).toBe('ボイスメッセージ.wav');
    expect(await readFile(upload.path)).toEqual(Buffer.from('not audio at all, really'));
    await store.close();
  });
});
