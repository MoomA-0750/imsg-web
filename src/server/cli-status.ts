import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { RpcError } from './rpc/errors.js';

/** Explicit diagnostic only: upstream CLI status can launch/repair Messages.app.
 * Never use for automatic Web polling or isolated no-launch experiments.
 * Bounded stdout, drained stderr, no raw diagnostics returned. */
export function cliStatus(executable: string): Promise<unknown> {
  if (!isAbsolute(executable) || executable.includes('\0')) return Promise.reject(new RpcError('CONFIG_INVALID'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['status', '--json'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let chunks: Buffer[] = [], size = 0, invalid = false;
    const stop = () => { invalid = true; chunks = []; child.kill('SIGTERM'); };
    const timeout = setTimeout(stop, 10_000);
    const kill = setTimeout(() => { invalid = true; child.kill('SIGKILL'); }, 12_000);
    const bound = setTimeout(() => {
      invalid = true;
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      reject(new RpcError('SHUTDOWN_FAILED'));
    }, 13_000);
    child.stdout.on('data', (data: Buffer) => {
      if (invalid) return;
      size += data.length;
      if (size > 1024 * 1024) stop(); else chunks.push(data);
    });
    child.stderr.resume();
    child.stdout.on('error', stop); child.stderr.on('error', stop);
    child.on('error', stop);
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(kill); clearTimeout(bound);
      if (invalid || code !== 0) { reject(new RpcError('CLI_STATUS_INVALID')); return; }
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new RpcError('CLI_STATUS_INVALID')); }
    });
  });
}
