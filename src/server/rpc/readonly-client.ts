import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { RpcError, isObject } from './errors.js';

const METHODS = ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe'] as const;
export type ReadMethod = typeof METHODS[number];
type Pending = {
  id: string; frame: string; timer: NodeJS.Timeout;
  resolve: (value: unknown) => void; reject: (error: RpcError) => void;
  removeAbort: () => void;
};
export type Notice = { method: string; params: unknown };
type Options = {
  executable: string;
  // Fixed application configuration, NEVER browser input. Tests launch a fake with Node.
  args?: readonly string[];
  timeoutMs?: number;
  shutdownGraceMs?: number;
  maxFrameBytes?: number;
};

/** P0 ONLY: a strictly read-only child. Never reuse its timeout/kill policy for mutations. */
export class ReadonlyRpcClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeoutMs: number;
  readonly #graceMs: number;
  readonly #maxFrame: number;
  readonly #active = new Map<string, Pending>();
  readonly #queue: Pending[] = [];
  readonly #listeners = new Set<(notice: Notice) => void>();
  #buffer = Buffer.alloc(0);
  #nextId = 0;
  #closed = false;
  #exited = false;
  #shutdown: Promise<void> | undefined;
  #resolveExit!: () => void;
  readonly #exit: Promise<void>;

  constructor(options: Options) {
    if (!isAbsolute(options.executable) || options.executable.includes('\0')) throw new RpcError('CONFIG_INVALID');
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#graceMs = options.shutdownGraceMs ?? 2_000;
    this.#maxFrame = options.maxFrameBytes ?? 4 * 1024 * 1024;
    if (![this.#timeoutMs, this.#graceMs, this.#maxFrame].every(n => Number.isSafeInteger(n) && n > 0)) {
      throw new RpcError('CONFIG_INVALID');
    }
    this.#exit = new Promise(resolve => { this.#resolveExit = resolve; });
    this.#child = spawn(options.executable, [...(options.args ?? ['rpc'])], {
      shell: false, stdio: 'pipe', windowsHide: true,
    });
    this.#child.stdout.on('data', (chunk: Buffer) => this.#consume(chunk));
    // Drain without buffering or logging diagnostics that may contain private data.
    this.#child.stderr.resume();
    this.#child.stderr.on('error', () => this.#fail('RPC_IO_ERROR'));
    this.#child.stdout.on('error', () => this.#fail('RPC_IO_ERROR'));
    this.#child.stdin.on('error', () => this.#fail('RPC_IO_ERROR'));
    this.#child.on('error', () => this.#fail('RPC_SPAWN_FAILED'));
    this.#child.stdout.on('end', () => this.#fail(this.#buffer.length ? 'RPC_PROTOCOL_INVALID' : 'RPC_EOF'));
    this.#child.once('close', () => {
      this.#exited = true;
      this.#resolveExit();
      this.#fail('RPC_EOF');
    });
  }

  get closed(): boolean { return this.#closed; }
  get counts(): { active: number; queued: number } {
    return { active: this.#active.size, queued: this.#queue.length };
  }

  onNotice(listener: (notice: Notice) => void): () => void {
    if (this.#closed) throw new RpcError('RPC_CLOSED');
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  request(method: ReadMethod, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    if (!METHODS.includes(method)) return Promise.reject(new RpcError('METHOD_FORBIDDEN'));
    if (this.#closed) return Promise.reject(new RpcError('RPC_CLOSED'));
    if (signal?.aborted) return Promise.reject(new RpcError('ABORTED'));
    if (!isObject(params)) return Promise.reject(new RpcError('PARAMS_INVALID'));
    if (this.#active.size >= 4 && this.#queue.length >= 32) return Promise.reject(new RpcError('QUEUE_OVERFLOW'));
    const id = String(++this.#nextId);
    let frame: string;
    try { frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'; }
    catch { return Promise.reject(new RpcError('PARAMS_INVALID')); }
    if (Buffer.byteLength(frame) > 64 * 1024) return Promise.reject(new RpcError('REQUEST_TOO_LARGE'));
    return new Promise((resolve, reject) => {
      const stop = (code: 'RPC_TIMEOUT' | 'ABORTED') => {
        if (this.#active.has(id)) {
          // Do not free an external execution slot and dispatch more work into a stuck child.
          this.#fail(code);
        } else {
          const index = this.#queue.findIndex(item => item.id === id);
          const item = this.#queue[index];
          if (item) { this.#queue.splice(index, 1); this.#settle(item, new RpcError(code)); }
        }
      };
      const abort = () => stop('ABORTED');
      const item: Pending = {
        id, frame, resolve, reject,
        timer: setTimeout(() => stop('RPC_TIMEOUT'), this.#timeoutMs),
        removeAbort: () => signal?.removeEventListener('abort', abort),
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.#queue.push(item);
      this.#pump();
    });
  }

  #pump(): void {
    while (!this.#closed && this.#active.size < 4 && this.#queue.length) {
      const item = this.#queue.shift()!;
      this.#active.set(item.id, item);
      this.#child.stdin.write(item.frame, error => { if (error) this.#fail('RPC_IO_ERROR'); });
    }
  }

  #consume(chunk: Buffer): void {
    if (this.#closed) return;
    let offset = 0;
    while (offset < chunk.length && !this.#closed) {
      const end = chunk.indexOf(10, offset);
      const piece = chunk.subarray(offset, end === -1 ? chunk.length : end);
      if (this.#buffer.length + piece.length > this.#maxFrame) { this.#fail('RPC_FRAME_TOO_LARGE'); return; }
      this.#buffer = Buffer.concat([this.#buffer, piece]);
      if (end === -1) return;
      const line = this.#buffer;
      this.#buffer = Buffer.alloc(0);
      offset = end + 1;
      try {
        // Fatal UTF-8 decoder prevents silently accepting corrupt multibyte content.
        const record: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!isObject(record) || record.jsonrpc !== '2.0') throw new Error();
        if (!Object.hasOwn(record, 'id')) {
          if (typeof record.method !== 'string' || !record.method.length || Object.hasOwn(record, 'result') || Object.hasOwn(record, 'error')) throw new Error();
          for (const listener of this.#listeners) listener({ method: record.method, params: record.params });
          continue;
        }
        if (typeof record.id !== 'string' && typeof record.id !== 'number' && record.id !== null) throw new Error();
        const hasResult = Object.hasOwn(record, 'result');
        const hasError = Object.hasOwn(record, 'error');
        if (hasResult === hasError || Object.hasOwn(record, 'method')) throw new Error();
        if (hasError && (!isObject(record.error) || !Number.isSafeInteger(record.error.code) || typeof record.error.message !== 'string')) throw new Error();
        // String IDs are intentional. A numeric lookalike must never resolve our request.
        const item = typeof record.id === 'string' ? this.#active.get(record.id) : undefined;
        if (!item) continue;
        this.#active.delete(item.id);
        this.#settle(item, hasError ? new RpcError('RPC_REMOTE_ERROR', (record.error as Record<string, unknown>).code as number) : undefined, record.result);
        this.#pump();
      } catch { this.#fail('RPC_PROTOCOL_INVALID'); }
    }
  }

  #settle(item: Pending, error?: RpcError, value?: unknown): void {
    clearTimeout(item.timer);
    item.removeAbort();
    if (error) item.reject(error); else item.resolve(value);
  }

  #fail(code: ConstructorParameters<typeof RpcError>[0]): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const item of [...this.#active.values(), ...this.#queue]) this.#settle(item, new RpcError(code));
    this.#active.clear(); this.#queue.length = 0;
    this.#listeners.clear(); this.#buffer = Buffer.alloc(0);
    // close() can still report a shutdown failure to the owner; avoid unhandled rejection here.
    void this.close().catch(() => {});
  }

  close(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    // Install promise before #fail recursively calls close.
    this.#shutdown = Promise.resolve().then(async () => {
      this.#fail('RPC_CLOSED');
      this.#child.stdin.end();
      const waitExit = (ms: number): Promise<boolean> => new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), ms);
        void this.#exit.then(() => { clearTimeout(timer); resolve(true); });
      });
      if (this.#exited || await waitExit(this.#graceMs)) return;
      this.#child.kill('SIGTERM');
      if (await waitExit(this.#graceMs)) return;
      this.#child.kill('SIGKILL');
      if (await waitExit(1000)) return;
      // Descendants can inherit stdio after the direct child exits. Do not kill
      // them, and do not let their pipes keep this host alive indefinitely.
      this.#child.stdin.destroy();
      this.#child.stdout.destroy();
      this.#child.stderr.destroy();
      this.#child.unref();
      throw new RpcError('SHUTDOWN_FAILED');
    });
    this.#fail('RPC_CLOSED');
    return this.#shutdown;
  }
}
