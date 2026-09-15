import { SendClient, type SendReply } from './rpc/send-client.js';
import { isObject } from './rpc/errors.js';
import type { Upload } from './uploads.js';
import { WebError } from './web-error.js';

/** off: sending is not offered. dry-run: everything runs but no message is dispatched. live: real sends. */
export type SendMode = 'off' | 'dry-run' | 'live';
/**
 * sent: imsg acknowledged delivery. failed: imsg reported the send did not
 * start (safe to edit and resend). unknown: no authoritative answer, or a
 * failure past the point of dispatch — it may or may not have gone out.
 * dry_run: validated and resolved a target, but nothing was dispatched.
 */
export type SendState = 'sent' | 'failed' | 'unknown' | 'dry_run';
export type SendInput = { chatId?: string; to?: string; text?: string; uploadIds?: string[] };
/** `sent`/`total` count attachments: imsg takes one file per send, so several become several messages. */
export type SendResult = { state: SendState; sent?: number; total?: number };

export const TEXT_MAX = 8000;
export const FILES_MAX = 10;
// A phone-like or email-like handle. imsg normalises further; this only rejects obvious nonsense.
const PHONE = /^\+?[0-9][0-9\s()\-.]{3,30}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{1,64}$/;

/** Just what the send path needs of the upload store, so tests need no filesystem. */
export interface UploadSource {
  take(id: string): Upload | undefined;
  discard(upload: Upload): Promise<void>;
}

export type SendServiceOptions = {
  mode: SendMode;
  /** Opaque chat id → the chat's guid in the current epoch, or undefined if unknown/stale. */
  resolveChatGuid: (id: string) => string | undefined;
  /** Makes a one-shot send child. Only called in 'live' mode. */
  clientFactory: () => SendClient;
  /** Absent: attachments cannot be sent. */
  uploads?: UploadSource;
  /** Where a send that did not go says so. Defaults to the process's own error output. */
  report?: (line: string) => void;
};

export interface Sender {
  readonly mode: SendMode;
  send(input: SendInput): Promise<SendResult>;
}

/**
 * Classifies an imsg error. A send is only 'failed' (safe to retry) when imsg
 * says nothing left the Mac: `retry_safe` / a `not_started` disposition, or a
 * plain invalid-params / invalid-request rejection. Anything else is 'unknown',
 * because the message may have gone out.
 */
function classifyError(reply: Extract<SendReply, { ok: false; ambiguous: false }>): SendState {
  const data = reply.data;
  if (isObject(data) && (data.retry_safe === true || data.disposition === 'not_started')) return 'failed';
  if (reply.code === -32602 || reply.code === -32600) return 'failed';
  return 'unknown';
}

/**
 * One line saying why a send did not go, for the owner to read afterwards. A send that fails before
 * it reaches Messages leaves no trace in chat.db and none in the system log, so without this there
 * is nothing at all to look at.
 *
 * Only shapes are written: whether there was an attachment, imsg's numeric code, the words it uses
 * for how far a send got, and — from a child that died before answering — its first line, already
 * stripped of anything that could be an address, a number or a path. No message text, no recipient,
 * no identifier of any kind.
 */
function trouble(state: SendState, reply: SendReply, attachment: boolean): string {
  const parts = [`state=${state}`, `attachment=${attachment ? 'yes' : 'no'}`];
  if (reply.ok) return '';
  if (reply.ambiguous) {
    parts.push(`lost=${reply.why}`);
    if (reply.note !== undefined) parts.push(`said="${reply.note}"`);
  } else {
    parts.push(`code=${reply.code}`);
    const data = reply.data;
    if (isObject(data)) {
      if (typeof data.disposition === 'string') parts.push(`disposition=${data.disposition.slice(0, 32)}`);
      if (typeof data.retry_safe === 'boolean') parts.push(`retry_safe=${data.retry_safe}`);
      if (typeof data.transport === 'string') parts.push(`transport=${data.transport.slice(0, 32)}`);
    }
    // imsg puts the AppleScript error number in its message; the number alone says what Messages refused.
    const applescript = /AppleScript error (-?\d{1,6})/.exec(reply.message);
    if (applescript) parts.push(`applescript=${applescript[1]}`);
  }
  return `send trouble: ${parts.join(' ')}`;
}

/**
 * The mutation counterpart to the read source. It validates, resolves the
 * target from an opaque id (so the browser never handles a real number for a
 * reply), and — only in 'live' mode — dispatches one send at a time.
 */
export class SendService implements Sender {
  #tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: SendServiceOptions) {}
  get mode(): SendMode { return this.options.mode; }

  async send(input: SendInput): Promise<SendResult> {
    if (this.options.mode === 'off') throw new WebError('SEND_DISABLED', 403);
    const text = typeof input.text === 'string' ? input.text : '';
    if (input.text !== undefined && typeof input.text !== 'string') throw new WebError('SEND_PARAMS_INVALID', 400);
    if ([...text].length > TEXT_MAX) throw new WebError('SEND_TOO_LONG', 400);

    const ids = input.uploadIds ?? [];
    if (ids.length > FILES_MAX) throw new WebError('SEND_TOO_MANY_FILES', 400);
    if (ids.length > 0 && !this.options.uploads) throw new WebError('SEND_ATTACHMENT_UNSUPPORTED', 400);
    // Claim every attachment up front: a half-claimed batch would leave files behind.
    const uploads: Upload[] = [];
    try {
      for (const id of ids) {
        const upload = this.options.uploads!.take(id);
        if (!upload) throw new WebError('UPLOAD_UNKNOWN', 409);
        uploads.push(upload);
      }
      if (uploads.length === 0 && text.trim() === '') throw new WebError('SEND_EMPTY', 400);

      const hasChat = typeof input.chatId === 'string' && input.chatId !== '';
      const hasTo = typeof input.to === 'string' && input.to !== '';
      if (hasChat === hasTo) throw new WebError('SEND_TARGET_INVALID', 400); // exactly one of chatId / to
      const target: Record<string, unknown> = {};
      if (hasChat) {
        const guid = this.options.resolveChatGuid(input.chatId!);
        if (!guid) throw new WebError('STALE_CHAT', 409);
        target.chat_guid = guid;
      } else {
        const recipient = input.to!.trim();
        if (!PHONE.test(recipient) && !EMAIL.test(recipient)) throw new WebError('SEND_RECIPIENT_INVALID', 400);
        target.to = recipient;
      }

      // The target is resolved and the text validated even in dry-run, so only the dispatch itself is skipped.
      if (this.options.mode === 'dry-run') return uploads.length > 0 ? { state: 'dry_run', sent: 0, total: uploads.length } : { state: 'dry_run' };

      // The whole batch holds the lane: another send must not interleave between our files.
      const run = this.#tail.then(async (): Promise<SendResult> => {
        const client = this.options.clientFactory();
        const report = this.options.report ?? ((line: string) => console.error(line));
        const outcome = (reply: SendReply, attachment: boolean): SendState => {
          const state = reply.ok ? 'sent' : reply.ambiguous ? 'unknown' : classifyError(reply);
          if (state !== 'sent') report(`${new Date().toISOString()} ${trouble(state, reply, attachment)}`);
          return state;
        };
        if (uploads.length === 0) {
          return { state: outcome(await client.send({ ...target, text, transport: 'applescript', service: 'auto' }), false) };
        }
        let sent = 0;
        for (const [index, upload] of uploads.entries()) {
          // imsg sends one file per call, so each attachment is its own message; the text rides with the first.
          const state = outcome(await client.send({ ...target, text: index === 0 ? text : '', file: upload.path, transport: 'applescript', service: 'auto' }), true);
          if (state !== 'sent') return { state, sent, total: uploads.length };
          sent++;
        }
        return { state: 'sent', sent, total: uploads.length };
      });
      this.#tail = run.catch(() => {});
      return await run;
    } finally {
      // imsg copies each file into Messages' own attachments area, so ours never outlive the send.
      for (const upload of uploads) await this.options.uploads!.discard(upload);
    }
  }
}
