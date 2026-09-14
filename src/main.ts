// FIRST import on purpose: ES modules evaluate static imports before this
// module's body, so a guard called inside main() would run only after every
// import below had already been evaluated.
import { refuseTaintedLaunch } from './server/launch-guard.js';
import { buildChildEnv, ensureChildTmpDir } from './server/child-env.js';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnerStore } from './server/owner-store.js';
import { adminCommand } from './server/admin.js';
import { LiveSource } from './server/live-source.js';
import { ImageConverter } from './server/image-convert.js';
import { startRuntime } from './server/runtime.js';

// stdout contains a secret only for explicitly requested setup/rotation. No request logging.
refuseTaintedLaunch();

async function main() {
  const input = process.argv.slice(2), directory = process.env.IMSG_WEB_STATE_DIR;
  const command = input[0] === 'auth' && input.length === 2 ? input[1] === 'revoke-all' ? 'revoke' : input[1] : input.length === 1 ? input[0] : undefined;
  if (!directory || !command) throw new Error();
  const store = new OwnerStore(directory);
  if (command === 'setup') { process.stdout.write(`${await store.setup()}\n`); return; }
  if (command === 'revoke' || command === 'rotate' || command === 'status') {
    const result = await adminCommand(store, command);
    process.stdout.write(command === 'rotate' ? `${result.key}\n` : command === 'status' ? `${JSON.stringify(result)}\n` : 'Sessions revoked.\n'); return;
  }
  if (command !== 'serve') throw new Error();
  const executable = process.env.IMSG_WEB_IMSG_PATH, origin = process.env.IMSG_WEB_ORIGIN;
  const rawPort = process.env.IMSG_WEB_PORT ?? '8787';
  if (!executable || !isAbsolute(executable) || executable.includes('\0') || !origin || !/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) throw new Error();
  const tmpDir = await ensureChildTmpDir(directory);
  const context = buildChildEnv({ tmpDir, cwd: tmpDir });
  const runtime = await startRuntime({ store, source: new LiveSource({ executable, context, expectedDatabasePath: context.databasePath, ...(process.platform === 'darwin' ? { converter: new ImageConverter({ executable: '/usr/bin/sips', context }) } : {}) }), origin, port: Number(rawPort), webDir: fileURLToPath(new URL('./web', import.meta.url)) });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runtime.close().then(() => { process.exitCode = 0; }, () => { process.stderr.write('Shutdown incomplete; instance lock retained.\n'); process.exitCode = 1; });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdout.write('Read-only server ready on loopback.\n');
}
void main().catch(() => { process.stderr.write('Startup or administration failed. Check configuration, permissions and instance lock locally.\n'); process.exitCode = 1; });
