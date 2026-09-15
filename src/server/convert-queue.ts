import { spawn } from 'node:child_process';
import type { ChildContext } from './child-env.js';
import { WebError } from './web-error.js';

export const CONVERT_TIMEOUT_MS = 20_000;
const MAX_RUNNING = 2, MAX_WAITING = 32, MAX_BACKGROUND = 64, CACHE_BYTES = 64 * 1024 * 1024;

export type QueueOptions = {
  /** The system tool this queue runs. Tests pass a stand-in script. */
  tool: string;
  /** The same fixed environment the imsg child gets; its TMPDIR is project-owned and 0700. */
  context: ChildContext;
  /** Test seam. */
  timeoutMs?: number;
};
type Job = { run: () => void; background: boolean };

/**
 * What every conversion here has in common: at most two system tools running at
 * once, one conversion per set of source bytes however many viewers ask for it,
 * a bounded cache of what came back, and a child that is killed rather than
 * waited on. Subclasses supply only the tool's own arguments and what counts as
 * a usable result.
 *
 * Background work (converting ahead of a view) uses at most one of the two
 * slots and always yields to a waiting view.
 */
export abstract class ConvertQueue {
  #running = 0;
  #queue: Job[] = [];
  #pending = new Map<string, Promise<Buffer>>();
  #cache = new Map<string, Buffer>();
  #cacheBytes = 0;
  constructor(protected readonly queue: QueueOptions) {}

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
    const task = this.#slot(background, async () => this.run(await load(), from))
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

  /** The conversion itself: the checked source bytes in, the bytes to serve out. */
  protected abstract run(input: Buffer, from: string): Promise<Buffer>;

  /** Fixed argv, no shell, the fixed environment, bounded time and stdout. */
  protected exec(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.queue.tool, args, { cwd, env: this.queue.context.env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '', settled = false;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new WebError('CONVERSION_FAILED', 415)); } };
      // Give up without waiting for the pipe: anything the child left behind could hold it open.
      const timer = setTimeout(() => { child.kill('SIGKILL'); child.stdout.destroy(); fail(); }, this.queue.timeoutMs ?? CONVERT_TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { if (stdout.length < 4096) stdout += chunk; });
      child.once('error', fail);
      child.once('close', (code, signal) => { if (code === 0 && !signal && !settled) { settled = true; clearTimeout(timer); resolve(stdout); } else fail(); });
    });
  }
}
