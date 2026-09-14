import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ConvertTarget, ImageConverter } from './image-convert.js';
import { WebError } from './web-error.js';

/**
 * Only these types are ever served, with this exact Content-Type. SVG is left
 * out on purpose: it can carry script. HEIC and JPEG XL are what iPhones send;
 * they are converted for browsers that do not accept them (see image-convert).
 */
export const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/jxl']);
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export type AttachmentFile = { type: string; size: number; stream: Readable };
/** `accept` is the browser's Accept header, used only to choose a format. */
export interface AttachmentSource { attachment(id: string, accept?: string): Promise<AttachmentFile> }

const unavailable = () => new WebError('ATTACHMENT_UNAVAILABLE', 404);
/** Kept here rather than imported, so this module has no runtime dependency on the converter. */
export const CONVERTIBLE: ReadonlySet<string> = new Set(['image/heic', 'image/heif', 'image/jxl']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

/**
 * The type the bytes actually have, or undefined. The type Messages recorded is
 * not trusted on its own: a link preview "image" can be an HTML page.
 */
export function sniffImage(head: Buffer): string | undefined {
  const ascii = (start: number, end: number) => head.toString('latin1', start, end);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (HEIF_BRANDS.has(brand)) return 'image/heif';
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  if ((head[0] === 0xff && head[1] === 0x0a) || head.subarray(0, 12).equals(Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))) return 'image/jxl';
  return undefined;
}

/** Whether an Accept header names this exact type with a nonzero quality; wildcards do not count. */
export function accepts(accept: string | undefined, type: string): boolean {
  return (accept ?? '').slice(0, 2048).split(',').some(part => {
    const [media, ...params] = part.split(';').map(value => value.trim().toLowerCase());
    const q = params.find(param => param.startsWith('q='));
    return media === type && (q === undefined || Number(q.slice(2)) > 0);
  });
}

type Checked = { handle: FileHandle; real: string; size: number; key: string; actual: string };

/**
 * Opens a file only if it really lies inside the Messages attachments folder,
 * after symlinks are resolved, is a regular file within the size bound, and
 * starts like an allowed image. The caller owns the returned handle.
 * The path comes from chat.db through imsg and is never shown to the browser.
 */
async function checked(root: string, path: string, type: string): Promise<Checked> {
  if (!IMAGE_TYPES.has(type)) throw unavailable();
  let real: string;
  try { real = await realpath(path); } catch { throw unavailable(); }
  if (!real.startsWith(root + sep)) throw unavailable();
  // O_NOFOLLOW closes the gap between realpath and open if the file is swapped for a link.
  const handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw unavailable(); });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ATTACHMENT_BYTES) throw unavailable();
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const actual = sniffImage(head.subarray(0, bytesRead));
    if (!actual || !IMAGE_TYPES.has(actual)) throw unavailable();
    return { handle, real, size: stat.size, key: `${real}:${stat.size}:${stat.mtimeMs}`, actual };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error instanceof WebError ? error : unavailable();
  }
}

async function readAll(file: Checked): Promise<Buffer> {
  const bytes = Buffer.alloc(file.size);
  const { bytesRead } = await file.handle.read(bytes, 0, file.size, 0);
  if (bytesRead !== file.size) throw unavailable();
  return bytes;
}

/** The formats to try for a browser, best first. Empty: send the original. */
function targetsFor(converter: ImageConverter, accept: string | undefined, actual: string): ConvertTarget[] {
  if (!CONVERTIBLE.has(actual) || accepts(accept, actual)) return [];
  return converter.targets.filter(target => target === 'image/jpeg' || accepts(accept, target));
}

/** Serves an image with the type its bytes show, converting it when the browser cannot draw it. */
export async function openAttachment(root: string, path: string, type: string, convert?: { converter: ImageConverter; accept: string | undefined }): Promise<AttachmentFile> {
  const file = await checked(root, path, type);
  try {
    const targets = convert ? targetsFor(convert.converter, convert.accept, file.actual) : [];
    if (convert && targets.length > 0) {
      const bytes = await readAll(file);
      await file.handle.close();
      for (const target of targets) {
        try { const output = await convert.converter.convert(file.key, async () => bytes, file.actual, target); return { type: target, size: output.length, stream: Readable.from([output]) }; }
        catch (error) { if (error instanceof WebError && error.status === 429) throw error; }
      }
      // Conversion failed: send the original, which some browsers can still draw.
      return { type: file.actual, size: bytes.length, stream: Readable.from([bytes]) };
    }
    // Read no more than was measured, so Content-Length stays true if the file grows.
    return { type: file.actual, size: file.size, stream: file.handle.createReadStream({ start: 0, end: file.size - 1 }) };
  } catch (error) {
    await file.handle.close().catch(() => {});
    throw error instanceof WebError ? error : unavailable();
  }
}

/**
 * Converts an image ahead of its first view, in the background, into the best
 * format the converter can make. Nothing is read until the conversion starts,
 * and the file is checked again then. Failures are silent: the view converts on demand.
 */
export async function prepareAttachment(root: string, path: string, type: string, converter: ImageConverter): Promise<void> {
  if (!CONVERTIBLE.has(type)) return;
  const first = await checked(root, path, type).catch(() => undefined);
  if (!first) return;
  await first.handle.close().catch(() => {});
  const target = converter.targets[0]!;
  if (!CONVERTIBLE.has(first.actual) || converter.has(first.key, target)) return;
  const load = async () => {
    const again = await checked(root, path, type);
    try {
      if (again.key !== first.key || again.actual !== first.actual) throw unavailable();
      return await readAll(again);
    } finally { await again.handle.close().catch(() => {}); }
  };
  await converter.convert(first.key, load, first.actual, target, true).catch(() => {});
}
