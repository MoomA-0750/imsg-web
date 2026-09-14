import { SendClient } from './rpc/send-client.js';
import { WebError } from './web-error.js';

/** off: sending is not offered. dry-run: everything runs but no message is dispatched. live: real sends. */
export type SendMode = 'off' | 'dry-run' | 'live';
/**
 * sent: the RPC acknowledged delivery. already_sent: this attempt_id had already
 * been used, so the earlier attempt went out. failed: rejected before anything
 * was sent. unknown: no authoritative answer — it may or may not have gone out.
 * dry_run: validated and resolved a target, but nothing was dispatched.
 */
export type SendState = 'sent' | 'already_sent' | 'failed' | 'unknown' | 'dry_run';
export type SendInput = { chatId?: string; to?: string; text: string; attemptId: string };
export type SendResult = { state: SendState; code?: string };

export const TEXT_MAX = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A phone-like or email-like handle. imsg normalises further; this only rejects obvious nonsense.
const PHONE = /^\+?[0-9][0-9\s()\-.]{3,30}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{1,64}$/;

export type SendServiceOptions = {
  mode: SendMode;
  /** Opaque chat id → the chat's guid in the current epoch, or undefined if unknown/stale. */
  resolveChatGuid: (id: string) => string | undefined;
  /** Makes a one-shot send child. Only called in 'live' mode. */
  clientFactory: () => SendClient;
};

export interface Sender {
  readonly mode: SendMode;
  send(input: SendInput): Promise<SendResult>;
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
    if (typeof input.attemptId !== 'string' || !UUID.test(input.attemptId)) throw new WebError('SEND_PARAMS_INVALID', 400);
    if (typeof input.text !== 'string') throw new WebError('SEND_PARAMS_INVALID', 400);
    if (input.text.trim() === '') throw new WebError('SEND_EMPTY', 400);
    if ([...input.text].length > TEXT_MAX) throw new WebError('SEND_TOO_LONG', 400);

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
    if (this.options.mode === 'dry-run') return { state: 'dry_run' };

    const params = { ...target, text: input.text, transport: 'applescript', service: 'auto', attempt_id: input.attemptId };
    // One live send at a time: two osascript-driven sends must not overlap.
    const run = this.#tail.then(() => this.options.clientFactory().send(params));
    this.#tail = run.catch(() => {});
    const reply = await run;
    if (reply.ok) return { state: 'sent' };
    if (reply.ambiguous) return { state: 'unknown' };
    // A reused attempt_id means the earlier attempt already went out.
    if (/already identifies a message/i.test(reply.message)) return { state: 'already_sent' };
    return { state: 'failed', code: String(reply.code) };
  }
}
