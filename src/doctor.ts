import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { refuseTaintedLaunch } from './server/launch-guard.js';
import { buildChildEnv, type ChildContext } from './server/child-env.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadonlyRpcClient } from './server/rpc/readonly-client.js';
import { RpcError, isObject } from './server/rpc/errors.js';
import { ReadonlyAdapter } from './server/readonly-adapter.js';
import { capabilities } from './server/capabilities.js';
import { cliStatus } from './server/cli-status.js';

type Check = { state: 'passed' | 'failed' | 'skipped'; reasonCode: string; count?: number; elapsedMs?: number };
export async function doctor(executable: string, context: ChildContext) {
  const client = new ReadonlyRpcClient({ executable, context });
  const adapter = new ReadonlyAdapter(client);
  const checks: Record<string, Check> = {};
  const run = async <T>(name: string, job: () => Promise<T>): Promise<T | undefined> => {
    const start = performance.now();
    try {
      const result = await job();
      checks[name] = { state: 'passed', reasonCode: 'OK', elapsedMs: Math.round(performance.now() - start) };
      return result;
    } catch (error) {
      checks[name] = { state: 'failed', reasonCode: error instanceof RpcError ? error.code : 'UNEXPECTED_ERROR', elapsedMs: Math.round(performance.now() - start) };
      return undefined;
    }
  };
  let status, cli;
  let notificationCount = 0;
  let overflowCount = 0;
  try {
    [status, cli] = await Promise.all([
      run('rpcStatus', () => adapter.status()), run('cliStatus', () => cliStatus(executable, context)),
    ]);
    const caps = capabilities(status?.raw, cli);
    if (caps.chats.state === 'available') {
      const chats = await run('chats', () => adapter.chats(1));
      if (chats) {
        checks.chats!.count = chats.length;
        if (chats[0] && caps.history.state === 'available') {
          const chatId = chats[0].id;
          const messages = await run('history', () => adapter.history(chatId, 1));
          if (messages) checks.history!.count = messages.length;
        } else checks.history = { state: 'skipped', reasonCode: chats.length ? caps.history.reasonCode : 'NO_CHATS' };
      } else checks.history = { state: 'skipped', reasonCode: 'CHATS_FAILED' };
    } else {
      checks.chats = { state: 'skipped', reasonCode: caps.chats.reasonCode };
      checks.history = { state: 'skipped', reasonCode: caps.history.reasonCode };
    }
    if (caps.watch.state === 'available' && !client.closed) {
      const subscription = await run('watchSubscribe', () => adapter.subscribe());
      if (subscription !== undefined) {
        const remove = client.onNotice(notice => {
          if (!isObject(notice.params) || notice.params.subscription !== subscription) return;
          if (notice.method === 'message') notificationCount = Math.min(notificationCount + 1, Number.MAX_SAFE_INTEGER);
          if (notice.method === 'watch.overflow') overflowCount = Math.min(overflowCount + 1, Number.MAX_SAFE_INTEGER);
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        await run('watchUnsubscribe', () => adapter.unsubscribe());
        remove();
      } else checks.watchUnsubscribe = { state: 'skipped', reasonCode: 'SUBSCRIBE_FAILED' };
    } else {
      checks.watchSubscribe = { state: 'skipped', reasonCode: caps.watch.reasonCode };
      checks.watchUnsubscribe = { state: 'skipped', reasonCode: 'SUBSCRIBE_NOT_STARTED' };
    }
  } finally { await run('shutdown', () => client.close()); }
  const ready = ['rpcStatus', 'chats', 'watchSubscribe', 'watchUnsubscribe', 'shutdown'].every(name => checks[name]?.state === 'passed')
    && checks.cliStatus?.reasonCode !== 'SHUTDOWN_FAILED'
    && (checks.history?.state === 'passed' || checks.history?.reasonCode === 'NO_CHATS');
  return {
    schemaVersion: 1, scope: 'P0a-readonly', ready,
    nodeVersion: process.versions.node, arch: process.arch,
    imsgVersion: status?.parsed.version ?? null,
    databaseReady: status?.parsed.databaseReady ?? null,
    bridgeReady: status?.parsed.bridgeReady ?? null,
    capabilities: capabilities(status?.raw, cli), checks,
    watch: { notificationCount, overflowCount, deliveryVerified: false },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const executable = process.env.IMSG_PATH;
  if (process.argv.length !== 2 || !executable || !isAbsolute(executable) || executable.includes('\0')) {
    process.stdout.write(JSON.stringify({ ready: false, reasonCode: 'CONFIG_INVALID' }) + '\n');
    process.exitCode = 1;
  } else {
    try {
      // Called here rather than at module scope: this module is also imported
      // by tests, and a self-executing guard would fire on import. The cost is
      // that it runs after this file's imports have been evaluated -- acceptable
      // for a manual diagnostic, not acceptable for the server, which is why
      // main.ts imports the guard first instead.
      refuseTaintedLaunch();
      // mkdtemp creates 0700. doctor is an explicit manual diagnostic with no
      // state directory of its own, so it owns a fresh directory per run.
      const dir = await mkdtemp(join(tmpdir(), 'imsg-web-doctor-'));
      const result = await doctor(executable, buildChildEnv({ tmpDir: dir, cwd: dir }));
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exitCode = result.ready ? 0 : 1;
    } catch {
      process.stdout.write(JSON.stringify({ ready: false, reasonCode: 'DOCTOR_FAILED' }) + '\n');
      process.exitCode = 1;
    }
  }
}
