import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createOwnedReaderGate } from './nonlaunch-owned-readers.mjs';
import { admit } from './nonlaunch-c06-admission.mjs';

// Isolated launcher for a measurement run.
//
// It deliberately does NOT use startRuntime or OwnerStore. Production startup
// takes an owner lock and a persisted owner hash; silently reusing it here
// would make a measurement indistinguishable from the service, and would put a
// real owner key on the path of an experiment. This builds its own application
// out of the same parts instead:
//
//   * the owner key is generated in memory for this run, never written to disk,
//     never returned, never logged. Auth gets its hash and nothing else.
//   * the imsg executable must be ADMITTED first, by resolved path and digest.
//     Admission is identity, not provenance, and this module says so rather
//     than treating a passing digest as a fitness judgement.
//   * every child imsg process is registered with the owned-reader gate at
//     construction, through the production `onChild` seam, so shutdown is
//     judged on the exact handles this run created and never on a pid or a
//     process name.
//   * the listener is loopback with an ephemeral port, chosen by the OS.
//
// The caller receives ownership of everything and must pass it to a runner that
// closes it. Nothing here is a production service and nothing here is approved
// for one.

const failure = (code) => Object.assign(new Error(code), { code });

// Children are sampled for memory, so the launcher needs a way to read RSS.
// `ps` is used rather than anything clever: it exists on both hosts, it takes
// explicit pids, and it never has to guess from a process name.
export function psRss(pids) {
  const result = new Map();
  if (!Array.isArray(pids) || pids.length === 0) return result;
  if (!pids.every((p) => Number.isInteger(p) && p > 0)) throw failure('RSS_PIDS_INVALID');
  let text;
  try {
    text = execFileSync('/bin/ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], {
      encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return result; }
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) result.set(Number(m[1]), Number(m[2]));
  }
  return result;
}

/**
 * @param options.dist       absolute path to the built dist directory
 * @param options.executable absolute RESOLVED path to the imsg product
 * @param options.sha256     expected digest of that product
 * @param options.stateDir   private directory for the child tmp dir
 * @param options.origin     the canonical https origin the app must require
 * @param options.databasePath the chat.db imsg must report, checked by LiveSource
 */
export async function launchIsolated({ dist, executable, sha256, stateDir, origin, databasePath }) {
  const admission = await admit([{ label: 'imsg', path: executable, sha256 }]);

  const { createApp } = await import(`${dist}/server/http.js`);
  const { Auth, hashKey } = await import(`${dist}/server/auth.js`);
  const { LiveSource } = await import(`${dist}/server/live-source.js`);
  const { ReadonlyRpcClient } = await import(`${dist}/server/rpc/readonly-client.js`);
  const { buildChildEnv, ensureChildTmpDir } = await import(`${dist}/server/child-env.js`);

  const tmpDir = await ensureChildTmpDir(stateDir);
  const context = buildChildEnv({ tmpDir, cwd: tmpDir });
  if (context.databasePath !== databasePath) throw failure('LAUNCH_DATABASE_MISMATCH');

  const readers = createOwnedReaderGate();
  const source = new LiveSource({
    executable,
    context,
    expectedDatabasePath: databasePath,
    // Every client this source builds goes through the gate, so no child can be
    // created without being registered first.
    factory: () => readers.factory((register) => new ReadonlyRpcClient({
      executable, context, onChild: register,
    })),
  });

  // In memory for this run only. Not persisted, not returned, not printed.
  const key = randomBytes(32).toString('base64url');
  const auth = new Auth(hashKey(key));

  const app = await createApp({ origin, auth, source, webDir: `${dist}/web` });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await app.close().catch(() => {});
    throw failure('LAUNCH_LISTENER_NOT_LOOPBACK');
  }

  return { app, auth, source, readers, key, origin, admission, port: address.port, sampleRss: psRss };
}
