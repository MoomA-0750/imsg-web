// Synthetic worker forwards its child's numeric registry; never launches imsg.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn(process.execPath, [fileURLToPath(new URL('./residue-child.mjs', import.meta.url))], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.pipe(process.stdout);
child.on('error', () => { process.exitCode = 1; });
