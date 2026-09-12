// Synthetic end-to-end worker only. Requires npm run build; never invokes imsg.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, hashKey } from '../../dist/server/auth.js';
import { createApp } from '../../dist/server/http.js';
import { buildChildEnv } from '../../dist/server/child-env.js';
import { LiveSource } from '../../dist/server/live-source.js';
import { ReadonlyRpcClient } from '../../dist/server/rpc/readonly-client.js';
import { createOwnedReaderGate } from '../../scripts/nonlaunch-owned-readers.mjs';
import { runApiWorker } from '../../scripts/nonlaunch-api-worker.mjs';

const mode = process.argv[2];
const registry = process.argv[3] === '--registry';
const record = value => { if (registry) writeSync(3, JSON.stringify(value) + '\n'); };
let dir, app, source, auth;
const readers = createOwnedReaderGate({ graceMs: 300, killWaitMs: 1000 });
const summary = await runApiWorker({
  async start(signal) {
    if (!['normal', 'hold', 'startup-fail'].includes(mode)) throw new Error();
    dir = await mkdtemp(join(tmpdir(), 'iw-worker-fixture-'));
    const path = join(dir, 'synthetic.db'); await writeFile(path, 'synthetic');
    const key = 'A'.repeat(43), origin = 'https://imsg.synthetic.test';
    auth = new Auth(hashKey(key));
    let count = 0;
    const context = buildChildEnv({ tmpDir: dir, cwd: dir, home: dir });
    source = new LiveSource({ executable: process.execPath, expectedDatabasePath: path, context, factory: () => readers.factory(register => new ReadonlyRpcClient({
      executable: process.execPath,
      context,
      args: [fileURLToPath(new URL('./nonlaunch-source-rpc.mjs', import.meta.url)), path, count++ === 0 || mode !== 'hold' ? 'normal' : 'hold-history'],
      onChild: child => {
        register(child);
        record({ event: 'child', pid: child.pid });
        if (count === 2) record({ event: 'sealed' });
      }, timeoutMs: 5000, shutdownGraceMs: 100,
    })) });
    app = await createApp({ auth, source, origin });
    if (mode === 'startup-fail' || signal.aborted) throw new Error('SYNTHETIC_STARTUP_FAILURE');
    await app.listen({ host: '127.0.0.1', port: 0 });
    record({ event: 'listener', port: app.server.address().port });
    return { app, auth, source, readers, key, origin };
  },
  async cleanupStartup() {
    auth?.revokeAll();
    const results = await Promise.allSettled([app?.close(), source?.close(), readers.close()]);
    return results.every(r => r.status === 'fulfilled') && (await readers.close()).allClosed;
  },
});
if (dir) await rm(dir, { recursive: true, force: true });
process.exitCode = summary.sessionSucceeded ? 0 : 1;
