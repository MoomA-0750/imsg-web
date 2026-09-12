import { lstat, mkdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * The exact environment and working directory handed to an `imsg` child.
 *
 * Before this module the child inherited the server's whole environment. That
 * matters because the pinned upstream source reads, on paths this project
 * touches: SSH_CONNECTION and SSH_CLIENT (which switch the contact source to
 * the AddressBook fallback), HOMEBREW_PREFIX (helper search order),
 * IMSG_BRIDGE_LEGACY_IPC, and — on the launch path — DYLD_INSERT_LIBRARIES,
 * which is how the helper gets injected into Messages.
 *
 * The set below is an allow-list, not a deny-list. A deny-list silently
 * permits whatever it forgot.
 */

declare const tag: unique symbol;

/** Constructible only by {@link buildChildEnv}, so `env: process.env` cannot type-check. */
export type ChildEnv = Readonly<Record<string, string>> & { readonly [tag]: 'ChildEnv' };

export type ChildContext = {
  readonly env: ChildEnv;
  readonly cwd: string;
  /** Where the Messages database is expected. Callers verify what imsg reports against this. */
  readonly databasePath: string;
};

export type ChildEnvInput = {
  /** A project-owned 0700 directory. Not the inherited TMPDIR. */
  readonly tmpDir: string;
  /** Must contain no `.build`: BridgeHelperLocator searches `.build/release` relative to cwd. */
  readonly cwd: string;
  /** Test seam. Production reads passwd. */
  readonly home?: string;
};

const FIXED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

// Fixing the locale removes a variable we would otherwise not control. It is
// NOT the basis of a parity claim: Darwin's Foundation takes locale from user
// preferences rather than LANG, and SQLite collation is BINARY.
const FIXED_LOCALE = 'en_US.UTF-8';

/** Exactly the keys {@link buildChildEnv} may produce. Asserted on the way out. */
const ALLOWED = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'] as const;

export class ChildEnvError extends Error {
  constructor(readonly code: 'CHILD_ENV_INVALID') { super(code); }
}

/**
 * The home directory from passwd, never from `$HOME`.
 *
 * `os.homedir()` prefers `$HOME`, so it would carry an inherited value straight
 * back in. Note that this is a defence in depth rather than the main control:
 * whether Foundation honours `$HOME` for `homeDirectoryForCurrentUser` is not
 * established, which is why callers must also verify the database path imsg
 * reports rather than trusting that the right HOME was passed.
 */
export function passwdHome(): string {
  const home = userInfo().homedir;
  if (!home || !isAbsolute(home)) throw new ChildEnvError('CHILD_ENV_INVALID');
  return home;
}

function checkPath(value: string) {
  if (!value || !isAbsolute(value) || value.includes('\0')) throw new ChildEnvError('CHILD_ENV_INVALID');
}

export function buildChildEnv(input: ChildEnvInput): ChildContext {
  const home = input.home ?? passwdHome();
  checkPath(home);
  checkPath(input.tmpDir);
  checkPath(input.cwd);
  // BridgeHelperLocator resolves `.build/release/<helper>` relative to the
  // working directory, so a cwd inside a build tree would change which helper
  // is found. Refuse the shape rather than document it.
  if (/(^|\/)\.build(\/|$)/.test(input.cwd)) throw new ChildEnvError('CHILD_ENV_INVALID');

  const env = {
    HOME: home,
    PATH: FIXED_PATH,
    TMPDIR: input.tmpDir,
    LANG: FIXED_LOCALE,
    LC_ALL: FIXED_LOCALE,
  };

  // There is no input that could become SSH_CONNECTION or SSH_CLIENT, and this
  // asserts it stays that way. Fabricating an SSH context would change the
  // contact source and produce a result about a configuration nobody runs.
  const keys = Object.keys(env).sort();
  if (keys.join(',') !== [...ALLOWED].sort().join(',')) throw new ChildEnvError('CHILD_ENV_INVALID');

  return {
    env: Object.freeze(env) as unknown as ChildEnv,
    cwd: input.cwd,
    databasePath: `${home}/Library/Messages/chat.db`,
  };
}

/**
 * Creates and validates the project-owned temporary directory the child is given.
 *
 * imsg's own temporary-directory use is confined to the send, attachment and
 * rich-link paths, none of which this project takes. But macOS links the system
 * libsqlite3, whose temp files follow TMPDIR, so inheriting or dropping it would
 * silently decide where SQLite spills sort and B-tree scratch. Owning the
 * directory is cheaper than reasoning about someone else's.
 */
export async function ensureChildTmpDir(stateDir: string): Promise<string> {
  checkPath(stateDir);
  const dir = join(stateDir, 'child-tmp');
  await mkdir(dir, { mode: 0o700, recursive: true });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.uid !== userInfo().uid || (info.mode & 0o777) !== 0o700) {
    throw new ChildEnvError('CHILD_ENV_INVALID');
  }
  return dir;
}
