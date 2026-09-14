import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildContext } from './child-env.js';
import { sniffImage } from './attachments.js';
import { WebError } from './web-error.js';

export const MAX_EDGE = 2048;
export const CONVERT_TIMEOUT_MS = 20_000;
const MAX_RUNNING = 2, MAX_WAITING = 32, MAX_BACKGROUND = 64, MAX_OUTPUT_BYTES = 16 * 1024 * 1024, CACHE_BYTES = 64 * 1024 * 1024;
/** `sips` picks the decoder from the extension, so the copy is named after the sniffed type. */
const EXTENSION: Record<string, string> = { 'image/heic': 'heic', 'image/heif': 'heif', 'image/jxl': 'jxl', 'image/x-apple-preview': 'ktx' };

export type ConverterOptions = {
  /** macOS `sips`. Tests pass a stand-in script. */
  sips: string;
  /** The same fixed environment the imsg child gets; its TMPDIR is project-owned and 0700. */
  context: ChildContext;
  /** Test seam. */
  timeoutMs?: number;
};
type Job = { run: () => void; background: boolean };

/**
 * Converts HEIC, JPEG XL and Messages' cached previews to JPEG with the system
 * `sips`. JPEG, because on the M1 it was the fastest to produce and WebP needed
 * a second tool and step that made it the slowest. The checked bytes are copied
 * into a private directory first, so `sips` never opens a path in Messages'
 * folders or a file swapped in after the checks. `sips` exits 0 even when it
 * fails, so success is judged only by the output's own first bytes.
 *
 * Background work (converting ahead of a view) uses at most one of the two
 * slots and always yields to a waiting view.
 */
export class ImageConverter {
  #running = 0;
  #queue: Job[] = [];
  #pending = new Map<string, Promise<Buffer>>();
  #cache = new Map<string, Buffer>();
  #cacheBytes = 0;
  constructor(private readonly options: ConverterOptions) {}

  has(key: string): boolean { return this.#cache.has(key); }

  /**
   * `key` must identify the exact source bytes (for example path, size and
   * mtime). `load` is called only when the conversion actually starts, so
   * queued work holds no file contents.
   */
  convert(key: string, load: () => Promise<Buffer>, from: string, background = false): Promise<Buffer> {
    const cached = this.#cache.get(key);
    if (cached) { this.#cache.delete(key); this.#cache.set(key, cached); return Promise.resolve(cached); }
    const shared = this.#pending.get(key); if (shared) return shared;
    const waiting = this.#queue.filter(job => job.background === background).length;
    if (waiting >= (background ? MAX_BACKGROUND : MAX_WAITING)) return Promise.reject(new WebError('BUSY', 429));
    const task = this.#slot(background, async () => this.#run(await load(), from))
      .then(output => { this.#remember(key, output); return output; })
      .finally(() => { this.#pending.delete(key); });
    this.#pending.set(key, task);
    return task;
  }

  #slot<T>(background: boolean, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({ background, run: () => { this.#running++; work().then(resolve, reject).finally(() => { this.#running--; this.#next(); }); } });
      this.#next();
    });
  }

  #next() {
    while (this.#running < MAX_RUNNING) {
      const index = this.#queue.findIndex(job => !job.background);
      if (index >= 0) { this.#queue.splice(index, 1)[0]!.run(); continue; }
      // Background work never takes the last free slot.
      if (this.#running === 0 && this.#queue.length > 0) { this.#queue.shift()!.run(); continue; }
      return;
    }
  }

  #remember(key: string, output: Buffer) {
    if (output.length > CACHE_BYTES / 4) return;
    this.#cache.set(key, output); this.#cacheBytes += output.length;
    for (const [oldKey, old] of this.#cache) {
      if (this.#cacheBytes <= CACHE_BYTES) break;
      this.#cache.delete(oldKey); this.#cacheBytes -= old.length;
    }
  }

  async #run(input: Buffer, from: string): Promise<Buffer> {
    const extension = EXTENSION[from];
    if (!extension) throw new WebError('CONVERSION_FAILED', 415);
    const dir = await mkdtemp(join(this.options.context.env.TMPDIR!, 'image-'));
    try {
      const source = join(dir, `in.${extension}`), target = join(dir, 'out.jpg');
      await writeFile(source, input, { mode: 0o600 });
      const size = await this.#exec(dir, ['-g', 'pixelWidth', '-g', 'pixelHeight', source]);
      const edges = [...size.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(match => Number(match[1]));
      // -Z also enlarges, so resample only an image that is larger than the bound.
      const resample = edges.length === 2 && Math.max(...edges) > MAX_EDGE ? ['-Z', String(MAX_EDGE)] : [];
      await this.#exec(dir, ['-s', 'format', 'jpeg', ...resample, source, '--out', target]);
      const output = await readFile(target).catch(() => undefined);
      if (!output || output.length === 0 || output.length > MAX_OUTPUT_BYTES || sniffImage(output.subarray(0, 16)) !== 'image/jpeg') throw new WebError('CONVERSION_FAILED', 415);
      return output;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Fixed argv, no shell, the fixed environment, bounded time and stdout. */
  #exec(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.sips, args, { cwd, env: this.options.context.env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
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
