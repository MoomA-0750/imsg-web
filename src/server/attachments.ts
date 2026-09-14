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

/**
 * Opens a file only if it really lies inside the Messages attachments folder,
 * after symlinks are resolved, and is a regular file within the size bound.
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
    // Read no more than was measured, so Content-Length stays true if the file grows.
    return { type, size: stat.size, stream: handle.createReadStream({ start: 0, end: stat.size - 1 }) };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error instanceof WebError ? error : unavailable();
  }
}
