import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { sep } from 'node:path';
import type { Readable } from 'node:stream';
import { WebError } from './web-error.js';

/**
 * Only these types are ever served, with this exact Content-Type. SVG is left
 * out on purpose: it can carry script. HEIC and JPEG XL are what iPhones send;
 * browsers that cannot decode them show the fallback text instead.
 */
export const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/jxl']);
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export type AttachmentFile = { type: string; size: number; stream: Readable };
export interface AttachmentSource { attachment(id: string): Promise<AttachmentFile> }

const unavailable = () => new WebError('ATTACHMENT_UNAVAILABLE', 404);
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
  }
  if ((head[0] === 0xff && head[1] === 0x0a) || head.subarray(0, 12).equals(Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))) return 'image/jxl';
  return undefined;
}

/**
 * Opens a file only if it really lies inside the Messages attachments folder,
 * after symlinks are resolved, is a regular file within the size bound, and
 * starts like an allowed image. It is served with the type its bytes show.
 * The path comes from chat.db through imsg and is never shown to the browser.
 */
export async function openAttachment(root: string, path: string, type: string): Promise<AttachmentFile> {
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
    // Read no more than was measured, so Content-Length stays true if the file grows.
    return { type: actual, size: stat.size, stream: handle.createReadStream({ start: 0, end: stat.size - 1 }) };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error instanceof WebError ? error : unavailable();
  }
}
