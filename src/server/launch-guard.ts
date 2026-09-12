/**
 * Refuses to continue when the process was started in an environment that can
 * change how code is loaded or linked.
 *
 * Deliberately import-free, and imported FIRST by every entry point: ES modules
 * evaluate static imports before the importing module's body, so a guard placed
 * inside `main()` would run after `owner-store`, `admin`, `live-source` and
 * `runtime` had already been evaluated.
 *
 * This is a tripwire, not a boundary, and the distinction matters. A module
 * loaded through `NODE_OPTIONS=--require` runs before anything here and can
 * delete the variable from `process.env` before this ever looks. What this
 * catches is a setting left lying around in the launchd domain — which is the
 * realistic case, since a launchd domain dictionary persists until logout or
 * `launchctl unsetenv`. It is not a defence against someone who wants in.
 *
 * Matching is by prefix rather than by enumeration: a list of exact names
 * silently permits the next variable Node or dyld adds.
 */

const REFUSED_PREFIXES = ['NODE_', 'DYLD_', 'UV_', 'SQLITE_'];

/**
 * NODE_ENV selects no loader and changes no linkage, and test runners set it.
 * It is the only exception, and it is an exception rather than a gap.
 */
const PREFIX_EXCEPTIONS = ['NODE_ENV'];

const REFUSED_NAMES = [
  'CFFIXED_USER_HOME', // Core Foundation prefers this over HOME.
  'OPENSSL_CONF', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HOMEBREW_PREFIX', // Changes the bridge helper search order.
  'SSH_CONNECTION', 'SSH_CLIENT', // Would fabricate an SSH context.
  'IMSG_BRIDGE_LEGACY_IPC', 'IMSG_LAUNCH_READY_TIMEOUT',
];

/** Names only. A refused value is never read, printed or stored. */
export function taintedNames(environment: Record<string, string | undefined>): string[] {
  const found: string[] = [];
  for (const name of Object.keys(environment)) {
    if (PREFIX_EXCEPTIONS.includes(name)) continue;
    if (REFUSED_PREFIXES.some(prefix => name.startsWith(prefix)) || REFUSED_NAMES.includes(name)) {
      found.push(name);
    }
  }
  return found.sort();
}

/**
 * Exits without serving when the launch environment is tainted.
 *
 * The message is its own fixed category. Every other failure in `main.ts`
 * funnels into one generic catch with exit 1, so a test asserting only "exits
 * non-zero" would pass against code that has no guard at all.
 */
export function refuseTaintedLaunch(
  environment: Record<string, string | undefined> = process.env,
  exit: (message: string) => never = message => { process.stderr.write(message); process.exit(78); },
): void {
  const names = taintedNames(environment);
  if (names.length === 0) return;
  exit(`Refused: tainted launch environment (${names.join(' ')}).\n`);
}
