import { describe, expect, it } from 'vitest';
import { Auth, PASSWORD_MAX, hashKey, hashPassword, passwordProblem } from '../src/server/auth.js';

const KEY = 'A'.repeat(43);
const OTHER_KEY = 'B'.repeat(43);
const DAY = 86_400_000;
function fixture() {
  let now = 1_000_000;
  const auth = new Auth(hashKey(KEY), () => now);
  return { auth, advance: (ms: number) => { now += ms; } };
}

describe('B02 independent authentication acceptance (synthetic)', () => {
  it('rejects invalid credentials and stores a cookie hash instead of its bearer token', async () => {
    const { auth } = fixture();
    for (const key of [undefined, null, {}, 42, '', OTHER_KEY, 'é'.repeat(43)]) {
      await expect(auth.login(key)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS', status: 401 }));
    }
    const first = await auth.login(KEY);
    const second = await auth.login(KEY);
    expect(first.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.cookie).not.toBe(second.cookie);
    expect(first.session.csrf).not.toBe(second.session.csrf);
    expect(first.session.hash).toBe(hashKey(first.cookie));
    expect(JSON.stringify(first.session)).not.toContain(first.cookie);
    expect(auth.lookup(first.cookie)).toBe(first.session);
    expect(auth.lookup(first.session.hash)).toBeUndefined();
  });

  it('allows 16 sessions, rejects the seventeenth, and recovers a slot after logout', async () => {
    const { auth } = fixture();
    const sessions = await Promise.all(Array.from({ length: 16 }, () => auth.login(KEY)));
    expect(auth.count).toBe(16);
    await expect(auth.login(KEY)).rejects.toThrowError(expect.objectContaining({ code: 'SESSION_LIMIT', status: 429 }));
    auth.logout(sessions[0]!.session);
    expect(auth.lookup(sessions[0]!.cookie)).toBeUndefined();
    expect(auth.lookup(sessions[1]!.cookie)).toBeDefined();
    await expect(auth.login(KEY)).resolves.toBeDefined();
    expect(auth.count).toBe(16);
  });

  it('expires at exactly 24 hours idle and prunes expired sessions before admitting a login', async () => {
    const { auth, advance } = fixture();
    const { cookie } = await auth.login(KEY);
    advance(DAY - 1);
    expect(auth.lookup(cookie)).toBeDefined();
    advance(1);
    expect(auth.lookup(cookie)).toBeUndefined();
    expect(auth.count).toBe(0);
    await expect(auth.login(KEY)).resolves.toBeDefined();
  });

  it('refreshes idle time on API access but never extends the seven-day absolute deadline', async () => {
    const { auth, advance } = fixture();
    const { cookie, session } = await auth.login(KEY);
    for (let i = 0; i < 7; i++) {
      advance(23 * 3_600_000);
      auth.access(session);
      expect(auth.lookup(cookie)).toBe(session);
    }
    advance(7 * DAY - 7 * 23 * 3_600_000 - 1);
    expect(auth.lookup(cookie)).toBeDefined();
    advance(1);
    expect(auth.lookup(cookie)).toBeUndefined();
    expect(() => auth.access(session)).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('limits all credential attempts together to 20 per minute and resets at the boundary', async () => {
    const { auth, advance } = fixture();
    for (let i = 0; i < 20; i++) await expect(auth.login(OTHER_KEY)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
    await expect(auth.login(KEY)).rejects.toThrowError(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
    advance(59_999);
    await expect(auth.login(KEY)).rejects.toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
    advance(1);
    await expect(auth.login(KEY)).resolves.toBeDefined();
  });

  it('limits API access to 120 per session per minute without sharing another session’s allowance', async () => {
    const { auth, advance } = fixture();
    const a = (await auth.login(KEY)).session;
    const b = (await auth.login(KEY)).session;
    for (let i = 0; i < 120; i++) auth.access(a);
    expect(() => auth.access(a)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
    expect(() => auth.access(b)).not.toThrow();
    advance(59_999);
    expect(() => auth.access(a)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
    advance(1);
    expect(() => auth.access(a)).not.toThrow();
  });

  it('revokes every existing bearer token while allowing a fresh login with the unchanged owner key', async () => {
    const { auth } = fixture();
    const a = await auth.login(KEY);
    const b = await auth.login(KEY);
    auth.revokeAll();
    expect(auth.lookup(a.cookie)).toBeUndefined();
    expect(auth.lookup(b.cookie)).toBeUndefined();
    expect(auth.valid(a.session)).toBe(false);
    expect(auth.count).toBe(0);
    await expect(auth.login(KEY)).resolves.toBeDefined();
  });

  it('blocks authentication during failed rotation and resumes only with the replacement key', async () => {
    const { auth } = fixture();
    const old = await auth.login(KEY);
    auth.block();
    expect(auth.blocked).toBe(true);
    expect(auth.lookup(old.cookie)).toBeUndefined();
    await expect(auth.login(KEY)).rejects.toThrowError(expect.objectContaining({ code: 'AUTH_RECOVERY_REQUIRED' }));
    auth.activate(hashKey(OTHER_KEY));
    expect(auth.blocked).toBe(false);
    expect(auth.lookup(old.cookie)).toBeUndefined();
    await expect(auth.login(KEY)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
    await expect(auth.login(OTHER_KEY)).resolves.toBeDefined();
  });

  it('accepts the chosen password and nothing near it, and stores neither the password nor a bare hash of it', async () => {
    const password = 'kaisha2026';
    const credential = await hashPassword(password);
    const auth = new Auth(credential);
    expect(auth.kind).toBe('password');
    await expect(auth.login(password)).resolves.toBeDefined();
    for (const wrong of [`${password} `, password.toUpperCase(), password.slice(0, -1), `${password}1`, hashKey(password), '', undefined, 42]) {
      await expect(auth.login(wrong)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    }
    // Salted and stretched: the same password twice is two different records, and neither is its SHA-256.
    const again = await hashPassword(password);
    expect(JSON.stringify(again)).not.toBe(JSON.stringify(credential));
    expect(JSON.stringify(credential)).not.toContain(password);
    expect(JSON.stringify(credential)).not.toContain(hashKey(password));
    await expect(new Auth(again).login(password)).resolves.toBeDefined();
  });

  it('holds a chosen password to eight characters with a letter and a digit, and judges it only when set', async () => {
    for (const bad of ['', 'ab3', 'seven77', 'password', '12345678', ' pass1234', 'pass1234 ', 'pass\u000012', 'a1'.repeat(PASSWORD_MAX), 42, undefined]) {
      expect(passwordProblem(bad)).toBeTypeOf('string');
      await expect(hashPassword(bad as string)).rejects.toMatchObject({ code: 'PASSWORD_WEAK', status: 400 });
    }
    // A letter means an ASCII letter, so a password written only in Japanese and digits is refused.
    expect(passwordProblem('合言葉は2026年')).toBeTypeOf('string');
    for (const good of ['pass1234', '合言葉はimsg2026', 'a'.repeat(200) + '1', 'パスワード pass 1']) expect(passwordProblem(good)).toBeUndefined();
    // An accepted password keeps working whatever the rule becomes, because logging in never re-judges it.
    const auth = new Auth(await hashPassword('pass1234'));
    await expect(auth.login('pass1234')).resolves.toBeDefined();
  });

  it('counts a password attempt before deriving it, so a flood is turned away rather than computed', async () => {
    let now = 1_000_000;
    const auth = new Auth(await hashPassword('pass1234'), () => now);
    const started = Date.now();
    const attempts = await Promise.allSettled(Array.from({ length: 40 }, () => auth.login('wrong-one1')));
    const limited = attempts.filter(a => a.status === 'rejected' && (a.reason as { code: string }).code === 'RATE_LIMITED');
    expect(limited).toHaveLength(20); // 20 derivations at most, not 40
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('does not restore sessions when the process creates a new Auth instance', async () => {
    const { auth } = fixture();
    const old = await auth.login(KEY);
    const restarted = new Auth(hashKey(KEY));
    expect(restarted.lookup(old.cookie)).toBeUndefined();
    await expect(restarted.login(KEY)).resolves.toBeDefined();
  });
});
