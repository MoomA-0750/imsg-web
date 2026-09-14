import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { ChildContext } from '../child-env.js';
import { isObject } from './errors.js';

/**
 * A mutation is not a read. The read-only client (`ReadonlyRpcClient`) kills its
 * child on timeout and fails the request — safe when nothing changed. A send
 * whose response never arrives *may already have gone out*, so its own lifecycle
 * is here, deliberately separate, and it reports that ambiguity instead of
 * pretending the send failed. `send.tracked` carries a caller UUID so an
 * explicit retry cannot double-send.
 */
export const SEND_METHOD = 'send.tracked';

export type SendReply =
  | { ok: true; raw: Record<string, unknown> }
  /** The RPC rejected it before any message went out (invalid params, unknown recipient, duplicate attempt_id). */
  | { ok: false; ambiguous: false; code: number; message: string }
  /** No authoritative response: it may or may not have been delivered. Never auto-retry without the same attempt_id. */
  | { ok: false; ambiguous: true };

export type SendClientOptions = {
  executable: string;
  context: ChildContext;
  /** Fixed application configuration, never browser input. Tests launch a fake with Node. */
  args?: readonly string[];
  /** Sending drives Messages through osascript, which is slow; allow well beyond a read timeout. */
  timeoutMs?: number;
  maxFrameBytes?: number;
};

/** One short-lived child per send: spawn, send once, read the one reply, close. No persistent mutation-capable process. */
export class SendClient {
  constructor(private readonly options: SendClientOptions) {
    if (!isAbsolute(options.executable) || options.executable.includes('\0')) throw new Error('SEND_CONFIG_INVALID');
    if (!options.context || typeof options.context.cwd !== 'string' || !options.context.env) throw new Error('SEND_CONFIG_INVALID');
  }

  send(params: Record<string, unknown>): Promise<SendReply> {
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const maxFrame = this.options.maxFrameBytes ?? 1024 * 1024;
    return new Promise<SendReply>(resolve => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.options.executable, [...(this.options.args ?? ['rpc'])], { shell: false, stdio: 'pipe', windowsHide: true, env: this.options.context.env, cwd: this.options.context.cwd });
      } catch { resolve({ ok: false, ambiguous: true }); return; }
      let buffer = Buffer.alloc(0);
      let settled = false;
      const finish = (reply: SendReply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { child.stdin.end(); } catch { /* already gone */ }
        child.kill('SIGTERM');
        resolve(reply);
      };
      const timer = setTimeout(() => finish({ ok: false, ambiguous: true }), timeoutMs);
      child.on('error', () => finish({ ok: false, ambiguous: true }));
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > maxFrame) { finish({ ok: false, ambiguous: true }); return; }
        for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10)) {
          const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
          let record: unknown;
          try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { finish({ ok: false, ambiguous: true }); return; }
          if (!isObject(record) || record.jsonrpc !== '2.0' || record.id !== '1') continue; // notices and stray ids are not our reply
          if (isObject(record.error) && Number.isSafeInteger(record.error.code)) {
            finish({ ok: false, ambiguous: false, code: record.error.code as number, message: typeof record.error.message === 'string' ? record.error.message : '' });
          } else if (isObject(record.result)) {
            finish({ ok: true, raw: record.result });
          } else {
            finish({ ok: false, ambiguous: true });
          }
          return;
        }
      });
      // The reply never came before the pipe closed: ambiguous, not a clean failure.
      child.stdout.on('end', () => finish({ ok: false, ambiguous: true }));
      child.once('close', () => finish({ ok: false, ambiguous: true }));
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: '1', method: SEND_METHOD, params }) + '\n', error => { if (error) finish({ ok: false, ambiguous: true }); });
      } catch { finish({ ok: false, ambiguous: true }); }
    });
  }
}
