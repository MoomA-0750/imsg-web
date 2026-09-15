import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { ChildContext } from '../child-env.js';
import { isObject } from './errors.js';

/**
 * A mutation is not a read. The read-only client (`ReadonlyRpcClient`) kills its
 * child on timeout and fails the request — safe when nothing changed. A send
 * whose response never arrives *may already have gone out*, so its own lifecycle
 * is here, deliberately separate, and it reports that ambiguity instead of
 * pretending the send failed.
 *
 * Plain `send` over the AppleScript transport (no IMCore injection, no SIP
 * change). `send.tracked` is not used: it requires the bridge transport. imsg's
 * error carries `disposition`/`retry_safe`, so a pre-dispatch failure is still
 * distinguishable from an ambiguous one — the service reads that.
 */
export const SEND_METHOD = 'send';

export type SendReply =
  | { ok: true; raw: Record<string, unknown> }
  /** The RPC returned an error. `data` is imsg's error payload (may name `disposition`/`retry_safe`). */
  | { ok: false; ambiguous: false; code: number; message: string; data: unknown }
  /**
   * No authoritative response: it may or may not have been delivered. `why` says which way the
   * answer went missing, and `note` carries the child's own first words when it had any — bounded
   * and stripped of anything that could be an address or a number, because a send that never
   * reaches Messages leaves no other trace anywhere to read.
   */
  | { ok: false; ambiguous: true; why: AmbiguousReason; note?: string };

/** timeout: no reply in time. closed: the child ended first. spawn: it never started. protocol: the reply made no sense. */
export type AmbiguousReason = 'timeout' | 'closed' | 'spawn' | 'protocol';

const NOTE_MAX = 160;
/** Whatever the child said, made safe to write down: one line, bounded, with addresses and numbers removed. */
export function safeNote(raw: string): string | undefined {
  const line = raw.split('\n').map(part => part.trim()).find(part => part !== '');
  if (line === undefined) return undefined;
  const cleaned = line
    .replace(/[^\s@]+@[^\s@]+/g, '<address>')
    .replace(/\+?\d[\d ()-]{5,}/g, '<number>')
    .replace(/\/\S+/g, '<path>')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
  return cleaned.slice(0, NOTE_MAX);
}

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
      } catch { resolve({ ok: false, ambiguous: true, why: 'spawn' }); return; }
      let buffer = Buffer.alloc(0);
      let complaint = '';
      let settled = false;
      const finish = (reply: SendReply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { child.stdin.end(); } catch { /* already gone */ }
        child.kill('SIGTERM');
        resolve(reply);
      };
      /** Ambiguous, with whatever the child had to say for itself. */
      const lost = (why: AmbiguousReason) => {
        const note = safeNote(complaint);
        finish({ ok: false, ambiguous: true, why, ...(note === undefined ? {} : { note }) });
      };
      const timer = setTimeout(() => lost('timeout'), timeoutMs);
      child.on('error', () => lost('spawn'));
      // Kept only to say why a send went missing, and only the first line of it ever leaves here.
      child.stderr.on('data', (chunk: Buffer) => { if (complaint.length < 2048) complaint += chunk.toString('utf8'); });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > maxFrame) { lost('protocol'); return; }
        for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10)) {
          const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
          let record: unknown;
          try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { lost('protocol'); return; }
          if (!isObject(record) || record.jsonrpc !== '2.0' || record.id !== '1') continue; // notices and stray ids are not our reply
          if (isObject(record.error) && Number.isSafeInteger(record.error.code)) {
            finish({ ok: false, ambiguous: false, code: record.error.code as number, message: typeof record.error.message === 'string' ? record.error.message : '', data: record.error.data });
          } else if (isObject(record.result)) {
            finish({ ok: true, raw: record.result });
          } else {
            lost('protocol');
          }
          return;
        }
      });
      // The reply never came before the pipe closed: ambiguous, not a clean failure.
      child.stdout.on('end', () => lost('closed'));
      child.once('close', () => lost('closed'));
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: '1', method: SEND_METHOD, params }) + '\n', error => { if (error) lost('closed'); });
      } catch { lost('closed'); }
    });
  }
}
