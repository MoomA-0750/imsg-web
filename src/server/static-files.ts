import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

/**
 * One file of the built page, held in memory with its compressed forms worked out once at start.
 * A file whose name carries Vite's content hash never changes under that name, so the browser may
 * keep it for a year without asking; everything else (the page itself, the icons) is asked about
 * each time and answered with 304 when it has not changed.
 */
export interface StaticFile {
  readonly type: string;
  readonly cacheControl: string;
  /** Weak, because the same file goes out in up to three encodings that mean the same thing. */
  readonly etag: string;
  readonly bodies: { readonly identity: Buffer; readonly br?: Buffer; readonly gzip?: Buffer };
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';
/** Below this, compressing saves less than the headers it adds. */
const COMPRESS_FROM = 1024;
const TEXT = /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg\+xml)/;
/** `index-DYWT1V6x.js`: Vite's eight-character content hash before the extension. */
const HASHED = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

const brotli = promisify(brotliCompress), gz = promisify(gzip);

export function hashedName(name: string): boolean { return HASHED.test(name); }

export async function staticFile(data: Buffer, type: string, immutable: boolean): Promise<StaticFile> {
  const etag = `W/"${createHash('sha256').update(data).digest('base64url').slice(0, 22)}"`;
  const cacheControl = immutable ? IMMUTABLE : REVALIDATE;
  if (data.length < COMPRESS_FROM || !TEXT.test(type)) return { type, cacheControl, etag, bodies: { identity: data } };
  const [br, gzipped] = await Promise.all([
    brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
    gz(data, { level: 9 }),
  ]);
  // Only an encoding that came out smaller is worth offering.
  return { type, cacheControl, etag, bodies: { identity: data, ...(br.length < data.length ? { br } : {}), ...(gzipped.length < data.length ? { gzip: gzipped } : {}) } };
}

/** What the browser will take, best first: br, then gzip, else the file as it is. */
export function chooseEncoding(header: string | undefined, file: StaticFile): 'br' | 'gzip' | 'identity' {
  const accepted = new Map<string, number>();
  for (const part of (header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map(p => /^\s*q=([0-9.]+)\s*$/.exec(p)).find(Boolean);
    accepted.set(name, q ? Number(q[1]) : 1);
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (file.bodies.br && ok('br')) return 'br';
  if (file.bodies.gzip && ok('gzip')) return 'gzip';
  return 'identity';
}

/** If-None-Match by weak comparison, which is what RFC 9110 asks of a GET. */
export function notModified(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some(tag => tag.trim().replace(/^W\//, '') === bare);
}
