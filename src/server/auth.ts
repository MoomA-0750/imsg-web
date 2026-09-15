import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { WebError } from './web-error.js';
const scrypt = promisify(scryptCallback) as (secret: string, salt: Buffer, length: number, options: ScryptOptions) => Promise<Buffer>;
export const newToken = () => randomBytes(32).toString('base64url');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const tokenValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export type Session = { hash: string; csrf: string; created: number; seen: number; window: number; count: number };

/**
 * How the owner proves who they are. A `token` is the 43-character random value the server
 * generates: 256 bits, so a single SHA-256 of it is enough — there is nothing to guess. A
 * `password` is chosen by the owner and therefore guessable, so it is stretched with scrypt and
 * salted, which is what makes a stolen owner.json expensive rather than instant to crack.
 */
export type Credential = { kind: 'token'; hash: string } | { kind: 'password'; salt: string; hash: string };

/** ~64 MiB and a few hundred ms per attempt: slow for a cracker, unnoticeable once a day. */
export const SCRYPT: ScryptOptions = { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]');

/**
 * What a chosen password must clear, checked when it is set rather than when it is used: an
 * existing password keeps working whatever this becomes. The bar is deliberately low at the
 * owner's request; it buys ~36^8 guesses, which the login rate limit covers online and scrypt
 * only slows offline.
 */
export function passwordProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'パスワードを入力してください。';
  const password = value.normalize('NFC');
  if ([...password].length < PASSWORD_MIN) return `${PASSWORD_MIN}文字以上にしてください。`;
  if (password.length > PASSWORD_MAX) return `${PASSWORD_MAX}文字以内にしてください。`;
  if (CONTROL.test(password)) return '使えない文字が含まれています。';
  if (password.trim() !== password) return '前後の空白は使えません。';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '英字と数字をそれぞれ1文字以上含めてください。';
  return undefined;
}

/** Derives the stored form of a password. Rejects one that does not clear `passwordProblem`. */
export async function hashPassword(value: string): Promise<Credential> {
  const problem = passwordProblem(value);
  if (problem) throw new WebError('PASSWORD_WEAK', 400);
  const salt = randomBytes(16);
  const derived = await scrypt(value.normalize('NFC'), salt, 32, SCRYPT);
  return { kind: 'password', salt: salt.toString('hex'), hash: derived.toString('hex') };
}

export function credentialValid(value: unknown): value is Credential {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.kind === 'token') return typeof c.hash === 'string' && /^[a-f0-9]{64}$/.test(c.hash);
  return c.kind === 'password' && typeof c.salt === 'string' && /^[a-f0-9]{32}$/.test(c.salt)
    && typeof c.hash === 'string' && /^[a-f0-9]{64}$/.test(c.hash);
}

export class Auth {
  readonly #sessions = new Map<string, Session>();
  #credential: Credential;
  #blocked = false;
  #attempts = 0;
  #window = 0;
  constructor(credential: Credential | string, private readonly now = Date.now, private readonly maxAge = 7 * 86400_000, private readonly idleAge = 86400_000) {
    this.#credential = typeof credential === 'string' ? { kind: 'token', hash: credential } : credential;
    if (!credentialValid(this.#credential)) throw new WebError('OWNER_INVALID');
  }
  get blocked() { return this.#blocked; }
  get count() { this.#prune(); return this.#sessions.size; }
  /** Which kind of secret the owner logs in with, for the sign-in screen's wording. */
  get kind(): Credential['kind'] { return this.#credential.kind; }
  #prune() { for (const s of this.#sessions.values()) if (!this.valid(s)) this.#sessions.delete(s.hash); }
  valid(s: Session): boolean {
    return !this.#blocked && this.#sessions.get(s.hash) === s && this.now() - s.created < this.maxAge && this.now() - s.seen < this.idleAge;
  }
  /**
   * Deriving a password costs real time, so the attempt counter is spent before any of it: a flood
   * is turned away at the twentieth try a minute, not after twenty derivations have been run.
   */
  async #matches(key: unknown): Promise<boolean> {
    const credential = this.#credential;
    if (credential.kind === 'token') return tokenValid(key) && equal(hashKey(key), credential.hash);
    if (typeof key !== 'string' || key.length === 0 || key.length > PASSWORD_MAX) return false;
    const derived = await scrypt(key.normalize('NFC'), Buffer.from(credential.salt, 'hex'), 32, SCRYPT);
    return equal(derived.toString('hex'), credential.hash);
  }
  async login(key: unknown): Promise<{ cookie: string; session: Session }> {
    const now = this.now();
    if (now - this.#window >= 60_000) { this.#window = now; this.#attempts = 0; }
    if (++this.#attempts > 20) throw new WebError('RATE_LIMITED', 429);
    if (this.#blocked) throw new WebError('AUTH_RECOVERY_REQUIRED');
    const matched = await this.#matches(key);
    // Blocking and revocation can land while a derivation is running; the state at the end decides.
    if (!matched || this.#blocked) throw new WebError(this.#blocked ? 'AUTH_RECOVERY_REQUIRED' : 'INVALID_CREDENTIALS', this.#blocked ? 503 : 401);
    this.#prune();
    if (this.#sessions.size >= 16) throw new WebError('SESSION_LIMIT', 429);
    const cookie = newToken();
    const session = { hash: hashKey(cookie), csrf: newToken(), created: this.now(), seen: this.now(), window: this.now(), count: 0 };
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
  activate(credential: Credential | string): void {
    const next = typeof credential === 'string' ? { kind: 'token' as const, hash: credential } : credential;
    if (!credentialValid(next)) throw new WebError('OWNER_INVALID');
    this.#credential = next; this.#blocked = false; this.revokeAll();
  }
}
