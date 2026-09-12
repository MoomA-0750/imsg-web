import { closeSync, openSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReadonlyRpcClient } from '../src/server/rpc/readonly-client.js';
import { buildChildEnv, passwdHome, ChildEnvError, type ChildContext } from '../src/server/child-env.js';
import { taintedNames, refuseTaintedLaunch } from '../src/server/launch-guard.js';

const reporter = resolve(fileURLToPath(new URL('./fixtures/env-report.mjs', import.meta.url)));

/**
 * These assert what the child RECEIVED, not what the caller configured. The
 * difference is the whole point: before this contract existed, the child
 * inherited everything and no test noticed, because every test asserted
 * configuration.
 */
async function childSees(context: ChildContext) {
  const client = new ReadonlyRpcClient({
    executable: process.execPath,
    args: [reporter],
    timeoutMs: 5_000,
    context,
  });
  try {
    const result = await client.request('status', {});
    return result as { names: string[]; cwd: string; fds: number[] };
  } finally {
    await client.close();
  }
}

describe('child environment contract', () => {
  it('hands the child exactly the allow-list, with the parent poisoned', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'child-env-'));
    // Poison the parent the way a launchd domain dictionary would.
    process.env.DYLD_INSERT_LIBRARIES = '/tmp/evil.dylib';
    process.env.NODE_OPTIONS = '--require /tmp/evil.js';
    process.env.SSH_CONNECTION = '10.0.0.1 1 10.0.0.2 22';
    process.env.HOMEBREW_PREFIX = '/tmp/brew';
    try {
      const context = buildChildEnv({ tmpDir: dir, cwd: dir, home: dir });
      const seen = await childSees(context);
      expect(seen.names).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
    } finally {
      delete process.env.DYLD_INSERT_LIBRARIES;
      delete process.env.NODE_OPTIONS;
      delete process.env.SSH_CONNECTION;
      delete process.env.HOMEBREW_PREFIX;
    }
  });

  it('does not hand the child descriptors the parent happens to hold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'child-fd-'));
    const context = buildChildEnv({ tmpDir: dir, cwd: dir, home: dir });

    // Counting the child's own descriptors proves nothing: a fresh Node process
    // already holds around twenty for libuv's event loop, so an absolute
    // assertion measures the runtime rather than inheritance. The difference
    // across a parent that has opened more is what actually answers it.
    const before = (await childSees(context)).fds.length;
    const opened: number[] = [];
    try {
      for (let i = 0; i < 12; i += 1) opened.push(openSync(fileURLToPath(import.meta.url), 'r'));
      const after = (await childSees(context)).fds.length;
      expect(after - before).toBe(0);
    } finally {
      for (const fd of opened) closeSync(fd);
    }
  });

  it('hands the child the configured working directory, not the parent\'s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'child-cwd-'));
    const context = buildChildEnv({ tmpDir: dir, cwd: dir, home: dir });
    const seen = await childSees(context);
    expect(seen.cwd).not.toBe(process.cwd());
    // macOS reports /private/tmp for /tmp, so compare the trailing segment.
    expect(seen.cwd.endsWith(dir.slice(dir.lastIndexOf('/')))).toBe(true);
  });
});

describe('child environment builder', () => {
  it('produces exactly the allow-listed keys and never an SSH variable', () => {
    const context = buildChildEnv({ tmpDir: '/private/tmp/a', cwd: '/private/tmp/b', home: '/Users/x' });
    expect(Object.keys(context.env).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
    expect('SSH_CONNECTION' in context.env).toBe(false);
    expect('SSH_CLIENT' in context.env).toBe(false);
  });

  it('derives the expected database path so callers can verify what imsg reports', () => {
    const context = buildChildEnv({ tmpDir: '/private/tmp/a', cwd: '/private/tmp/b', home: '/Users/x' });
    expect(context.databasePath).toBe('/Users/x/Library/Messages/chat.db');
  });

  it('refuses a working directory inside a build tree', () => {
    // BridgeHelperLocator searches .build/release relative to cwd.
    expect(() => buildChildEnv({ tmpDir: '/private/tmp/a', cwd: '/private/tmp/t/.build/release', home: '/Users/x' }))
      .toThrow(ChildEnvError);
  });

  it('refuses relative paths', () => {
    expect(() => buildChildEnv({ tmpDir: 'rel', cwd: '/private/tmp/b', home: '/Users/x' })).toThrow(ChildEnvError);
    expect(() => buildChildEnv({ tmpDir: '/private/tmp/a', cwd: 'rel', home: '/Users/x' })).toThrow(ChildEnvError);
  });

  it('takes the home directory from passwd rather than $HOME', () => {
    const original = process.env.HOME;
    process.env.HOME = '/tmp/not-the-real-home';
    try {
      expect(passwdHome()).not.toBe('/tmp/not-the-real-home');
    } finally {
      if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    }
  });
});

describe('launch guard', () => {
  it('reports names only, by prefix and by exact name', () => {
    expect(taintedNames({
      NODE_OPTIONS: 'x', DYLD_LIBRARY_PATH: 'x', UV_THREADPOOL_SIZE: 'x',
      SQLITE_TMPDIR: 'x', CFFIXED_USER_HOME: 'x', SSH_CONNECTION: 'x',
      HOMEBREW_PREFIX: 'x', PATH: 'x', HOME: 'x',
    })).toEqual([
      'CFFIXED_USER_HOME', 'DYLD_LIBRARY_PATH', 'HOMEBREW_PREFIX',
      'NODE_OPTIONS', 'SQLITE_TMPDIR', 'SSH_CONNECTION', 'UV_THREADPOOL_SIZE',
    ]);
  });

  it('excepts NODE_ENV, which selects no loader', () => {
    expect(taintedNames({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('never puts a value in its message', () => {
    let message = '';
    expect(() => refuseTaintedLaunch(
      { DYLD_INSERT_LIBRARIES: '/secret/path/that/must/not/appear.dylib' },
      text => { message = text; throw new Error('exited'); },
    )).toThrow('exited');
    expect(message).toContain('DYLD_INSERT_LIBRARIES');
    expect(message).not.toContain('/secret/path');
  });

  it('uses its own category rather than the generic startup failure', () => {
    let message = '';
    expect(() => refuseTaintedLaunch({ NODE_OPTIONS: 'x' }, text => { message = text; throw new Error('exited'); }))
      .toThrow('exited');
    expect(message).toContain('Refused: tainted launch environment');
  });

  it('passes a clean environment through', () => {
    expect(() => refuseTaintedLaunch({ PATH: '/usr/bin', HOME: '/Users/x' })).not.toThrow();
  });
});
