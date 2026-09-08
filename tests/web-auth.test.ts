import { describe, expect, it } from 'vitest';
import { Auth, hashKey } from '../src/server/auth.js';

const KEY = 'A'.repeat(43);
const OTHER_KEY = 'B'.repeat(43);
const DAY = 86_400_000;
function fixture() {
  let now = 1_000_000;
  const auth = new Auth(hashKey(KEY), () => now);
  return { auth, advance: (ms: number) => { now += ms; } };
}

describe('B02 independent authentication acceptance (synthetic)', () => {
  it('rejects invalid credentials and stores a cookie hash instead of its bearer token', () => {
    const { auth } = fixture();
    for (const key of [undefined, null, {}, 42, '', OTHER_KEY, 'é'.repeat(43)]) {
      expect(() => auth.login(key)).toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS', status: 401 }));
    }
    const first = auth.login(KEY);
    const second = auth.login(KEY);
    expect(first.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.cookie).not.toBe(second.cookie);
    expect(first.session.csrf).not.toBe(second.session.csrf);
    expect(first.session.hash).toBe(hashKey(first.cookie));
    expect(JSON.stringify(first.session)).not.toContain(first.cookie);
    expect(auth.lookup(first.cookie)).toBe(first.session);
    expect(auth.lookup(first.session.hash)).toBeUndefined();
  });

  it('allows 16 sessions, rejects the seventeenth, and recovers a slot after logout', () => {
    const { auth } = fixture();
    const sessions = Array.from({ length: 16 }, () => auth.login(KEY));
    expect(auth.count).toBe(16);
    expect(() => auth.login(KEY)).toThrowError(expect.objectContaining({ code: 'SESSION_LIMIT', status: 429 }));
    auth.logout(sessions[0]!.session);
    expect(auth.lookup(sessions[0]!.cookie)).toBeUndefined();
    expect(auth.lookup(sessions[1]!.cookie)).toBeDefined();
    expect(auth.login(KEY)).toBeDefined();
    expect(auth.count).toBe(16);
  });

  it('expires at exactly 24 hours idle and prunes expired sessions before admitting a login', () => {
    const { auth, advance } = fixture();
    const { cookie } = auth.login(KEY);
    advance(DAY - 1);
    expect(auth.lookup(cookie)).toBeDefined();
    advance(1);
    expect(auth.lookup(cookie)).toBeUndefined();
    expect(auth.count).toBe(0);
    expect(auth.login(KEY)).toBeDefined();
  });

  it('refreshes idle time on API access but never extends the seven-day absolute deadline', () => {
    const { auth, advance } = fixture();
    const { cookie, session } = auth.login(KEY);
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

  it('limits all credential attempts together to 20 per minute and resets at the boundary', () => {
    const { auth, advance } = fixture();
    for (let i = 0; i < 20; i++) expect(() => auth.login(OTHER_KEY)).toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
    expect(() => auth.login(KEY)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
    advance(59_999);
    expect(() => auth.login(KEY)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
    advance(1);
    expect(auth.login(KEY)).toBeDefined();
  });

  it('limits API access to 120 per session per minute without sharing another session’s allowance', () => {
    const { auth, advance } = fixture();
    const a = auth.login(KEY).session;
    const b = auth.login(KEY).session;
    for (let i = 0; i < 120; i++) auth.access(a);
    expect(() => auth.access(a)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
    expect(() => auth.access(b)).not.toThrow();
    advance(59_999);
    expect(() => auth.access(a)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
    advance(1);
    expect(() => auth.access(a)).not.toThrow();
  });

  it('revokes every existing bearer token while allowing a fresh login with the unchanged owner key', () => {
    const { auth } = fixture();
    const a = auth.login(KEY);
    const b = auth.login(KEY);
    auth.revokeAll();
    expect(auth.lookup(a.cookie)).toBeUndefined();
    expect(auth.lookup(b.cookie)).toBeUndefined();
    expect(auth.valid(a.session)).toBe(false);
    expect(auth.count).toBe(0);
    expect(auth.login(KEY)).toBeDefined();
  });

  it('blocks authentication during failed rotation and resumes only with the replacement key', () => {
    const { auth } = fixture();
    const old = auth.login(KEY);
    auth.block();
    expect(auth.blocked).toBe(true);
    expect(auth.lookup(old.cookie)).toBeUndefined();
    expect(() => auth.login(KEY)).toThrowError(expect.objectContaining({ code: 'AUTH_RECOVERY_REQUIRED' }));
    auth.activate(hashKey(OTHER_KEY));
    expect(auth.blocked).toBe(false);
    expect(auth.lookup(old.cookie)).toBeUndefined();
    expect(() => auth.login(KEY)).toThrowError(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
    expect(auth.login(OTHER_KEY)).toBeDefined();
  });

  it('does not restore sessions when the process creates a new Auth instance', () => {
    const { auth } = fixture();
    const old = auth.login(KEY);
    const restarted = new Auth(hashKey(KEY));
    expect(restarted.lookup(old.cookie)).toBeUndefined();
    expect(restarted.login(KEY)).toBeDefined();
  });
});
