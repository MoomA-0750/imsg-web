import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildContext } from './child-env.js';
import { sniffImage } from './attachments.js';
import { WebError } from './web-error.js';

export type ConvertTarget = 'image/avif' | 'image/jpeg';
export const MAX_EDGE = 2048;
export const CONVERT_TIMEOUT_MS = 20_000;
const MAX_RUNNING = 2, MAX_WAITING = 32, MAX_OUTPUT_BYTES = 16 * 1024 * 1024, CACHE_BYTES = 64 * 1024 * 1024;
const EXTENSION: Record<string, string> = { 'image/heic': 'heic', 'image/heif': 'heif', 'image/jxl': 'jxl', 'image/avif': 'avif', 'image/jpeg': 'jpg' };
const FORMAT: Record<ConvertTarget, string> = { 'image/avif': 'avif', 'image/jpeg': 'jpeg' };

export type ConverterOptions = {
  /** macOS `sips`. Tests pass a stand-in script. */
  executable: string;
  /** The same fixed environment the imsg child gets; its TMPDIR is project-owned and 0700. */
  context: ChildContext;
  /** Test seam. */
  timeoutMs?: number;
};

/**
 * Converts an image with `sips`. The checked bytes are copied into a private
 * directory first, so `sips` never opens a path in Messages' folders and cannot
 * be pointed at a file swapped in after the checks. `sips` exits 0 even when it
 * fails, so success is judged only by the output's own first bytes.
 */
export class ImageConverter {
  #running = 0;
  #waiting: (() => void)[] = [];
  #pending = new Map<string, Promise<Buffer>>();
  #cache = new Map<string, Buffer>();
  #cacheBytes = 0;
  constructor(private readonly options: ConverterOptions) {}

  /** `key` must identify the exact source bytes (for example path, size and mtime). */
  convert(key: string, input: Buffer, from: string, to: ConvertTarget): Promise<Buffer> {
    const full = `${to}:${key}`;
    const cached = this.#cache.get(full);
    if (cached) { this.#cache.delete(full); this.#cache.set(full, cached); return Promise.resolve(cached); }
    const shared = this.#pending.get(full); if (shared) return shared;
    if (this.#running >= MAX_RUNNING && this.#waiting.length >= MAX_WAITING) return Promise.reject(new WebError('BUSY', 429));
    const task = this.#slot(() => this.#run(input, from, to)).then(output => { this.#remember(full, output); return output; }).finally(() => { this.#pending.delete(full); });
    this.#pending.set(full, task);
    return task;
  }

  async #slot<T>(job: () => Promise<T>): Promise<T> {
    if (this.#running >= MAX_RUNNING) await new Promise<void>(resolve => this.#waiting.push(resolve));
    this.#running++;
    try { return await job(); } finally { this.#running--; this.#waiting.shift()?.(); }
  }

  #remember(key: string, output: Buffer) {
    if (output.length > CACHE_BYTES / 4) return;
    this.#cache.set(key, output); this.#cacheBytes += output.length;
    for (const [oldKey, old] of this.#cache) {
      if (this.#cacheBytes <= CACHE_BYTES) break;
      this.#cache.delete(oldKey); this.#cacheBytes -= old.length;
    }
  }

  async #run(input: Buffer, from: string, to: ConvertTarget): Promise<Buffer> {
    const extension = EXTENSION[from];
    if (!extension) throw new WebError('CONVERSION_FAILED', 415);
    const dir = await mkdtemp(join(this.options.context.env.TMPDIR!, 'image-'));
    try {
      const source = join(dir, `in.${extension}`), target = join(dir, `out.${EXTENSION[to]}`);
      await writeFile(source, input, { mode: 0o600 });
      const size = await this.#exec(dir, ['-g', 'pixelWidth', '-g', 'pixelHeight', source]);
      const edges = [...size.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(match => Number(match[1]));
      // -Z also enlarges, so resample only an image that is larger than the bound.
      const resample = edges.length === 2 && Math.max(...edges) > MAX_EDGE ? ['-Z', String(MAX_EDGE)] : [];
      await this.#exec(dir, ['-s', 'format', FORMAT[to], ...resample, source, '--out', target]);
      const output = await readFile(target).catch(() => undefined);
      if (!output || output.length === 0 || output.length > MAX_OUTPUT_BYTES || sniffImage(output.subarray(0, 16)) !== to) throw new WebError('CONVERSION_FAILED', 415);
      return output;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Runs sips with fixed argv, no shell, the fixed environment, bounded time and stdout. */
  #exec(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable, args, { cwd, env: this.options.context.env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '', settled = false;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new WebError('CONVERSION_FAILED', 415)); } };
      // Give up without waiting for the pipe: anything the child left behind could hold it open.
      const timer = setTimeout(() => { child.kill('SIGKILL'); child.stdout.destroy(); fail(); }, this.options.timeoutMs ?? CONVERT_TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { if (stdout.length < 4096) stdout += chunk; });
      child.once('error', fail);
      child.once('close', (code, signal) => { if (code === 0 && !signal && !settled) { settled = true; clearTimeout(timer); resolve(stdout); } else fail(); });
    });
  }
}
