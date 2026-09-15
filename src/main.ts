// FIRST import on purpose: ES modules evaluate static imports before this
// module's body, so a guard called inside main() would run only after every
// import below had already been evaluated.
import { refuseTaintedLaunch } from './server/launch-guard.js';
import { buildChildEnv, ensureChildTmpDir } from './server/child-env.js';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnerStore } from './server/owner-store.js';
import { adminCommand } from './server/admin.js';
import { ContactPhotos } from './server/contact-photos.js';
import { passwordProblem } from './server/auth.js';
import { LiveSource } from './server/live-source.js';
import { ImageConverter } from './server/image-convert.js';
import { SendService, type SendMode } from './server/send-service.js';
import { UploadStore } from './server/uploads.js';
import { SendClient } from './server/rpc/send-client.js';
import { startRuntime } from './server/runtime.js';

// stdout contains a secret only for explicitly requested setup/rotation. No request logging.
refuseTaintedLaunch();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > 4096) throw new Error();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
  // The password arrives on stdin, never in argv, where `ps` would show it to every process.
  if (command === 'set-password') {
    const password = (await readStdin()).split('\n', 1)[0] ?? '';
    const problem = passwordProblem(password);
    if (problem) { process.stderr.write(`${problem}\n`); process.exitCode = 1; return; }
    await adminCommand(store, 'set-password', password);
    process.stdout.write('Password set. Every session was signed out.\n'); return;
  }
  if (command !== 'serve') throw new Error();
  const executable = process.env.IMSG_WEB_IMSG_PATH, origin = process.env.IMSG_WEB_ORIGIN;
  const rawPort = process.env.IMSG_WEB_PORT ?? '8787';
  if (!executable || !isAbsolute(executable) || executable.includes('\0') || !origin || !/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) throw new Error();
  const tmpDir = await ensureChildTmpDir(directory);
  const context = buildChildEnv({ tmpDir, cwd: tmpDir });
  // The address book sits beside Messages under the same verified home; a contact's picture is read
  // from there, read-only, and a store that will not open simply means initials instead.
  const addressBook = join(dirname(dirname(context.databasePath)), 'Application Support', 'AddressBook');
  const source = new LiveSource({ executable, context, expectedDatabasePath: context.databasePath,
    ...(process.platform === 'darwin' ? { converter: new ImageConverter({ sips: '/usr/bin/sips', context }), photos: new ContactPhotos(addressBook) } : {}) });
  // Sending is off unless explicitly configured, and only on macOS. IMSG_WEB_SEND=dry-run resolves and validates but sends nothing.
  const sendSetting = process.platform === 'darwin' ? process.env.IMSG_WEB_SEND : undefined;
  const sendMode: SendMode = sendSetting === '1' || sendSetting === 'live' ? 'live' : sendSetting === 'dry-run' ? 'dry-run' : 'off';
  const uploads = new UploadStore({ dir: join(tmpDir, 'uploads') });
  const sender = new SendService({ mode: sendMode, resolveChatGuid: id => source.resolveChatGuid(id), clientFactory: () => new SendClient({ executable, context }), uploads });
  const runtime = await startRuntime({ store, source, sender, uploads, origin, port: Number(rawPort), webDir: fileURLToPath(new URL('./web', import.meta.url)) });
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
