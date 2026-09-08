import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebError } from './web-error.js';
export const newToken = () => randomBytes(32).toString('base64url');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const tokenValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export type Session = { hash: string; csrf: string; created: number; seen: number; window: number; count: number };

export class Auth {
  readonly #sessions = new Map<string, Session>();
  #blocked = false;
  #attempts = 0;
  #window = 0;
  constructor(private keyHash: string, private readonly now = Date.now, private readonly maxAge = 7 * 86400_000, private readonly idleAge = 86400_000) {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new WebError('OWNER_INVALID');
  }
  get blocked() { return this.#blocked; }
  get count() { this.#prune(); return this.#sessions.size; }
  #prune() { for (const s of this.#sessions.values()) if (!this.valid(s)) this.#sessions.delete(s.hash); }
  valid(s: Session): boolean {
    return !this.#blocked && this.#sessions.get(s.hash) === s && this.now() - s.created < this.maxAge && this.now() - s.seen < this.idleAge;
  }
  login(key: unknown): { cookie: string; session: Session } {
    const now = this.now();
    if (now - this.#window >= 60_000) { this.#window = now; this.#attempts = 0; }
    if (++this.#attempts > 20) throw new WebError('RATE_LIMITED', 429);
    if (this.#blocked) throw new WebError('AUTH_RECOVERY_REQUIRED');
    if (!tokenValid(key) || !equal(hashKey(key), this.keyHash)) throw new WebError('INVALID_CREDENTIALS', 401);
    this.#prune();
    if (this.#sessions.size >= 16) throw new WebError('SESSION_LIMIT', 429);
    const cookie = newToken();
    const session = { hash: hashKey(cookie), csrf: newToken(), created: now, seen: now, window: now, count: 0 };
    this.#sessions.set(session.hash, session);
    return { cookie, session };
  }
  lookup(cookie: unknown): Session | undefined {
    if (!tokenValid(cookie)) return;
    const s = this.#sessions.get(hashKey(cookie));
    if (!s) return;
    if (!this.valid(s)) { this.#sessions.delete(s.hash); return; }
    return s;
  }
  access(session: Session): void {
    if (!this.valid(session)) throw new WebError('UNAUTHORIZED', 401);
    const now = this.now();
    if (now - session.window >= 60_000) { session.window = now; session.count = 0; }
    if (++session.count > 120) throw new WebError('RATE_LIMITED', 429);
    session.seen = now;
  }
  logout(session: Session): void { this.#sessions.delete(session.hash); }
  revokeAll(): void { this.#sessions.clear(); }
  block(): void { this.#blocked = true; this.revokeAll(); }
  activate(keyHash: string): void { this.keyHash = keyHash; this.#blocked = false; this.revokeAll(); }
}
