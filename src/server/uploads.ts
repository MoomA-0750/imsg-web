import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebError } from './web-error.js';

/** Streamed straight to disk, so a large attachment never sits in memory or inflates through base64. */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PENDING = 8;
const TTL_MS = 10 * 60_000;
const NAME_MAX = 120;

export type Upload = { id: string; dir: string; path: string; name: string; bytes: number; created: number };

/**
 * The on-disk name is what the recipient sees (imsg stages the file under its
 * last path component), so the owner's filename is kept — with anything that
 * could escape the directory or confuse a shell removed.
 */
/** Built from a string so the escapes survive editing; matches C0 controls and DEL. */
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function safeFileName(raw: string | undefined): string {
  const base = (raw ?? '').normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(CONTROL, '').replace(/^\.+/, '').trim();
  const limited = [...cleaned].slice(0, NAME_MAX).join('').trim();
  return limited === '' ? 'attachment' : limited;
}

export type UploadStoreOptions = {
  /** A project-owned 0700 directory; each upload gets its own subdirectory inside it. */
  dir: string;
  maxBytes?: number;
  maxPending?: number;
  ttlMs?: number;
  now?: () => number;
};

/** Holds attachments between the upload request and the send that consumes them. */
export class UploadStore {
  readonly #pending = new Map<string, Upload>();
  constructor(private readonly options: UploadStoreOptions) {}
  get maxBytes(): number { return this.options.maxBytes ?? UPLOAD_MAX_BYTES; }
  #now(): number { return (this.options.now ?? Date.now)(); }

  async accept(body: Readable, rawName: string | undefined): Promise<Upload> {
    await this.sweep();
    if (this.#pending.size >= (this.options.maxPending ?? MAX_PENDING)) throw new WebError('UPLOAD_LIMIT', 429);
    const id = randomBytes(32).toString('base64url');
    const dir = join(this.options.dir, id);
    const name = safeFileName(rawName);
    const path = join(dir, name);
    const max = this.maxBytes;
    let bytes = 0;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > max) throw new WebError('UPLOAD_TOO_LARGE', 413);
            yield chunk;
          }
        },
        createWriteStream(path, { mode: 0o600 }),
      );
      if (bytes === 0) throw new WebError('UPLOAD_EMPTY', 400);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error instanceof WebError ? error : new WebError('UPLOAD_FAILED', 400);
    }
    const upload: Upload = { id, dir, path, name, bytes, created: this.#now() };
    this.#pending.set(id, upload);
    return upload;
  }

  /** One-shot: a given upload can only be consumed by a single send. */
  take(id: string): Upload | undefined {
    const upload = this.#pending.get(id);
    if (upload) this.#pending.delete(id);
    return upload;
  }

  async discard(upload: Upload): Promise<void> {
    await rm(upload.dir, { recursive: true, force: true }).catch(() => {});
  }

  async sweep(): Promise<void> {
    const ttl = this.options.ttlMs ?? TTL_MS;
    for (const upload of [...this.#pending.values()]) {
      if (this.#now() - upload.created <= ttl) continue;
      this.#pending.delete(upload.id);
      await this.discard(upload);
    }
  }

  /** Nothing an owner uploaded outlives the server. */
  async close(): Promise<void> {
    for (const upload of [...this.#pending.values()]) {
      this.#pending.delete(upload.id);
      await this.discard(upload);
    }
  }
}
