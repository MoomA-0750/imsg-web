import { createHmac, randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ReadSource, ChatSnapshot, HistorySnapshot, CapabilitySnapshot } from '../shared/web-types.js';
import { ReadonlyAdapter } from './readonly-adapter.js';
import { ReadonlyRpcClient } from './rpc/readonly-client.js';
import type { ChildContext } from './child-env.js';
import { isObject } from './rpc/errors.js';
import { capabilities } from './capabilities.js';
import { WebError } from './web-error.js';

type Client = Pick<ReadonlyRpcClient, 'request' | 'close' | 'closed'>;
export type SourceOptions = {
  executable: string;
  /** The exact environment and cwd for every imsg child this source starts. */
  context: ChildContext;
  /**
   * The database path imsg must report. Required, and it lives here rather than
   * being derived inside, because the source is what verifies it: an
   * allow-listed environment stops stray variables reaching the child but
   * cannot prove the right HOME was passed, and a wrong one makes imsg open a
   * different chat.db and succeed.
   */
  expectedDatabasePath: string;
  factory?: () => Client;
};
export function clip(text: string, length: number) {
  const cut = text.length > length;
  let value = text.slice(0, length);
  if (cut && /[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return { value, trimmed: cut };
}

export class LiveSource implements ReadSource {
  #client: Client | undefined;
  #adapter: ReadonlyAdapter | undefined;
  #identity: string | undefined;
  #epoch = randomBytes(16).toString('hex');
  #key = randomBytes(32);
  #map = new Map<string, { row: number; guid: string }>();
  #tail: Promise<unknown> = Promise.resolve();
  #pending = new Map<string, Promise<unknown>>();
  #stopped = false;
  #closeFailed = false;
  #closing: Promise<void> | undefined;
  constructor(private readonly options: SourceOptions) {}
  #id(kind: string, value: string): string { return createHmac('sha256', this.#key).update(`${this.#epoch}:${kind}:${value}`).digest('base64url'); }
  #rotateEpoch() { this.#epoch = randomBytes(16).toString('hex'); this.#map.clear(); }
  async #retire() {
    this.#rotateEpoch(); this.#identity = undefined;
    if (this.#client) {
      try { await this.#client.close(); }
      catch { this.#closeFailed = true; throw new WebError('READER_RECOVERY_REQUIRED'); }
    }
    this.#client = undefined; this.#adapter = undefined;
  }
  #queue<T>(key: string, job: () => Promise<T>): Promise<T> {
    if (this.#stopped || this.#closeFailed) return Promise.reject(new WebError('READER_RECOVERY_REQUIRED'));
    key = `${this.#epoch}:${key}`;
    const shared = this.#pending.get(key); if (shared) return shared as Promise<T>;
    // One active + at most32 distinct waiting operations. Coalesced readers don't allocate another slot.
    if (this.#pending.size >= 33) return Promise.reject(new WebError('BUSY', 429));
    const epoch = this.#epoch;
    const task = this.#tail.then(async () => {
      if (this.#stopped || this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED');
      if (epoch !== this.#epoch) throw new WebError('DB_CHANGED', 409);
      return job();
    }).finally(() => { this.#pending.delete(key); });
    this.#tail = task.catch(() => {}); this.#pending.set(key, task); return task;
  }
  async #fingerprint(path: string): Promise<string> {
    const s = await stat(path, { bigint: true });
    if (!s.isFile()) throw new WebError('DATABASE_UNAVAILABLE');
    return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
  }
  async #context(): Promise<{ raw: unknown; path: string; identity: string; epoch: string; adapter: ReadonlyAdapter }> {
    this.#ensureActive();
    if (this.#client?.closed) await this.#retire();
    this.#ensureActive();
    const fresh = !this.#client;
    if (!this.#client) {
      this.#client = this.options.factory?.() ?? new ReadonlyRpcClient({ executable: this.options.executable, context: this.options.context });
      this.#adapter = new ReadonlyAdapter(this.#client as ReadonlyRpcClient);
    }
    const { raw, parsed } = await this.#adapter!.status();
    this.#ensureActive();
    const db = isObject(raw) && isObject(raw.database) ? raw.database : undefined;
    // Absolute is not enough. An allow-listed environment stops stray variables
    // reaching the child; it cannot prove the right HOME was passed, and a wrong
    // one makes imsg open a different chat.db and SUCCEED. Verifying the path it
    // reports turns "reads the wrong data" into "fails".
    const reported = typeof db?.path === 'string' && isAbsolute(db.path) ? db.path : undefined;
    const path = reported === this.options.expectedDatabasePath ? reported : undefined;
    if (!path || !parsed.databaseReady) { const established = this.#identity !== undefined; await this.#retire(); throw new WebError(established ? 'DB_CHANGED' : 'DATABASE_UNAVAILABLE', established ? 409 : 503); }
    let identity: string;
    try { identity = `${path}:${await this.#fingerprint(path)}`; }
    catch { const established = this.#identity !== undefined; await this.#retire(); throw new WebError(established ? 'DB_CHANGED' : 'DATABASE_UNAVAILABLE', established ? 409 : 503); }
    this.#ensureActive();
    if (this.#identity !== undefined && identity !== this.#identity) { await this.#retire(); throw new WebError('DB_CHANGED', 409); }
    if (fresh) {
      // Bootstrap only discovers the path. Open the usable reader AFTER its identity
      // has been sampled, so an old handle cannot be labelled with a replacement inode.
      await this.#client!.close().catch(() => { this.#closeFailed = true; throw new WebError('READER_RECOVERY_REQUIRED'); });
      this.#ensureActive();
      this.#client = this.options.factory?.() ?? new ReadonlyRpcClient({ executable: this.options.executable, context: this.options.context });
      this.#adapter = new ReadonlyAdapter(this.#client as ReadonlyRpcClient);
      this.#identity = identity;
      return this.#context();
    }
    this.#identity = identity;
    return { raw, path, identity, epoch: this.#epoch, adapter: this.#adapter! };
  }
  #ensureActive() { if (this.#stopped || this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED'); }
  async #verify(path: string, identity: string, epoch: string) {
    this.#ensureActive();
    let current: string | undefined;
    try { current = `${path}:${await this.#fingerprint(path)}`; } catch { /* rotate below */ }
    if (epoch !== this.#epoch || current !== identity) { await this.#retire(); throw new WebError('DB_CHANGED', 409); }
  }
  chats(limit: number): Promise<ChatSnapshot> {
    return this.#queue(`chats:${limit}`, async () => {
      const c = await this.#context();
      const features = capabilities(c.raw);
      if (features.chats.state !== 'available') throw new WebError(features.chats.reasonCode);
      const rows = await c.adapter.chats(limit);
      await this.#verify(c.path, c.identity, c.epoch);
      if (this.#map.size + rows.filter(row => !this.#map.has(this.#id('chat', row.guid))).length > 2000) this.#rotateEpoch();
      return { epoch: this.#epoch, limit, chats: rows.map(row => {
        const id = this.#id('chat', row.guid); this.#map.set(id, { row: row.id, guid: row.guid });
        const name = clip(row.name, 512);
        return { id, name: name.value, service: row.service === 'iMessage' || row.service === 'SMS' ? row.service : 'Other', isGroup: row.isGroup, unreadCount: row.unreadCount, lastMessageAt: row.lastMessageAt, trimmed: name.trimmed };
      }) };
    });
  }
  history(id: string, limit: number): Promise<HistorySnapshot> {
    return this.#queue(`history:${id}:${limit}`, async () => {
      const target = this.#map.get(id); if (!target) throw new WebError('STALE_CHAT', 409);
      const c = await this.#context();
      if (!this.#map.has(id)) throw new WebError('DB_CHANGED', 409);
      if (capabilities(c.raw).history.state !== 'available') throw new WebError('HISTORY_UNAVAILABLE');
      const rows = await c.adapter.history(target.row, limit);
      await this.#verify(c.path, c.identity, c.epoch);
      return { epoch: this.#epoch, limit, messages: rows.reverse().map(row => {
        const text = clip(row.text, 16384);
        return { id: this.#id('message', row.guid), text: text.value, isFromMe: row.isFromMe, createdAt: row.createdAt, trimmed: text.trimmed };
      }) };
    });
  }
  capabilities(): Promise<CapabilitySnapshot> {
    return this.#queue('capabilities', async () => {
      const c = await this.#context();
      await this.#verify(c.path, c.identity, c.epoch);
      return { epoch: this.#epoch, mode: 'readonly', features: capabilities(c.raw) };
    });
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#stopped = true;
    // Interrupt read-only work, not a mutation. Queued operations observe stopped.
    this.#closing = (async () => { await this.#retire(); await this.#tail; if (this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED'); })();
    return this.#closing;
  }
}
