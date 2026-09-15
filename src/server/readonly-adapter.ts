import { ReadonlyRpcClient } from './rpc/readonly-client.js';
import { RpcError, isObject } from './rpc/errors.js';
import { parseStatus, type Status } from './capabilities.js';

type Chat = { id: number; name: string; guid: string; service: string; isGroup: boolean | null; unreadCount: number | null; lastMessageAt: string | null };
export type Attachment = { path: string; type: string; missing: boolean; sticker: boolean };
/** From imsg-patches/link-preview: what Messages stored with a link. Never fetched from the network. */
export type LinkPreview = { url: string; originalUrl: string | null; title: string; summary: string; siteName: string; image: Attachment | null };
/** The message this one replies to, as imsg resolved it from chat.db. */
export type ReplyContext = { sender: string | null; text: string };
/** A tapback someone put on this message. `kind` is imsg's name (like/love/laugh/…); `emoji` is its character. */
export type Reaction = { kind: string; emoji: string; sender: string | null; fromMe: boolean };
type Message = { id: number; chatId: number; text: string; guid: string; isFromMe: boolean; sender: string | null; attachments: Attachment[]; link: LinkPreview | null; replyTo: ReplyContext | null; reactions: Reaction[]; createdAt: string | null };
const MAX_REACTIONS = 24;
const MAX_ATTACHMENTS = 32;
const text = (v: unknown) => typeof v === 'string' ? v : '';
/** Only an absolute http(s) URL of sane length can become something the owner clicks. */
function webUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try { const url = new URL(v); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null; } catch { return null; }
}
const attachment = (a: Record<string, unknown>): Attachment => ({ path: text(a.original_path), type: text(a.mime_type).toLowerCase(), missing: a.missing !== false, sticker: a.is_sticker === true });
/** Only a reply whose parent imsg could actually resolve is worth showing. */
function replyContext(item: Record<string, unknown>): ReplyContext | null {
  const parent = text(item.reply_to_text);
  if (parent === '') return null;
  return { sender: text(item.reply_to_sender) || null, text: parent };
}
function reactions(value: unknown): Reaction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_REACTIONS).filter(isObject).map(item => ({
    kind: text(item.type), emoji: text(item.emoji),
    sender: item.is_from_me === true ? null : text(item.sender_name) || text(item.sender) || null,
    fromMe: item.is_from_me === true,
  })).filter(reaction => reaction.kind !== '' || reaction.emoji !== '');
}
function linkPreview(v: unknown): LinkPreview | null {
  if (!isObject(v)) return null;
  const originalUrl = webUrl(v.original_url), url = webUrl(v.url) ?? originalUrl;
  if (!url) return null;
  return { url, originalUrl, title: text(v.title), summary: text(v.summary), siteName: text(v.site_name), image: isObject(v.image) ? attachment(v.image) : null };
}
const date = (v: unknown) => typeof v === 'string' && v.length < 50 && Number.isFinite(Date.parse(v)) ? v : null;
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
function limitValid(limit: number): void { if (!positive(limit) || limit > 1000) throw new RpcError('PARAMS_INVALID'); }

export class ReadonlyAdapter {
  #subscription: number | 'pending' | undefined;
  #unsubscribeTask: Promise<void> | undefined;
  constructor(readonly client: ReadonlyRpcClient) {}
  async status(): Promise<{ raw: unknown; parsed: Status }> {
    const raw = await this.client.request('status');
    const parsed = parseStatus(raw);
    if (!parsed) throw new RpcError('RPC_PROTOCOL_INVALID');
    return { raw, parsed };
  }
  async chats(limit = 50): Promise<Chat[]> {
    limitValid(limit);
    const raw = await this.client.request('chats.list', { limit });
    if (!isObject(raw) || !Array.isArray(raw.chats) || raw.chats.length > limit) throw new RpcError('RPC_PROTOCOL_INVALID');
    return raw.chats.map(item => {
      if (!isObject(item) || !positive(item.id) || typeof item.name !== 'string' || typeof item.guid !== 'string' || typeof item.service !== 'string') throw new RpcError('RPC_PROTOCOL_INVALID');
      // imsg's `name` is the chat title, or the raw handle when there is none. Only
      // in the second case does the resolved contact name read better.
      const identifier = text(item.identifier), titled = item.name !== '' && item.name !== identifier;
      return { id: item.id, name: (titled ? item.name : text(item.contact_name) || item.name || identifier) || '名前のない会話', guid: item.guid, service: item.service,
        isGroup: typeof item.is_group === 'boolean' ? item.is_group : null,
        unreadCount: Number.isSafeInteger(item.unread_count) && (item.unread_count as number) >= 0 ? item.unread_count as number : null,
        lastMessageAt: date(item.last_message_at) };
    });
  }
  async history(chatId: number, limit = 50): Promise<Message[]> {
    limitValid(limit);
    if (!positive(chatId)) throw new RpcError('PARAMS_INVALID');
    // Attachment metadata only. convert_attachments stays off, so imsg never runs a converter or writes a cache.
    const raw = await this.client.request('messages.history', { chat_id: chatId, limit, attachments: true, convert_attachments: false });
    if (!isObject(raw) || !Array.isArray(raw.messages) || raw.messages.length > limit) throw new RpcError('RPC_PROTOCOL_INVALID');
    return raw.messages.map(item => {
      if (!isObject(item) || !positive(item.id) || item.chat_id !== chatId || typeof item.guid !== 'string' || typeof item.text !== 'string' || typeof item.is_from_me !== 'boolean') throw new RpcError('RPC_PROTOCOL_INVALID');
      // A link preview is stored as an untyped plugin payload; the link itself is already in the text.
      const attachments = Array.isArray(item.attachments) ? item.attachments.filter(isObject).filter(a => !text(a.filename).endsWith('.pluginPayloadAttachment')).slice(0, MAX_ATTACHMENTS).map(attachment) : [];
      return { id: item.id, chatId, text: item.text, guid: item.guid, isFromMe: item.is_from_me,
        sender: item.is_from_me ? null : text(item.sender_name) || text(item.sender) || null, attachments, link: linkPreview(item.link_preview),
        replyTo: replyContext(item), reactions: reactions(item.reactions), createdAt: date(item.created_at) };
    });
  }
  async subscribe(): Promise<number> {
    if (this.#subscription !== undefined) throw new RpcError('WATCH_ACTIVE');
    this.#subscription = 'pending';
    try {
      const raw = await this.client.request('watch.subscribe', { attachments: false });
      if (!isObject(raw) || !positive(raw.subscription)) throw new RpcError('RPC_PROTOCOL_INVALID');
      this.#subscription = raw.subscription;
      return raw.subscription;
    } catch (error) {
      // An accepted subscription with a malformed response must not leave an untracked watcher.
      await this.client.close();
      throw error;
    }
  }
  unsubscribe(): Promise<void> {
    if (this.#unsubscribeTask) return this.#unsubscribeTask;
    if (this.#subscription === undefined) return Promise.resolve();
    if (this.#subscription === 'pending') return Promise.reject(new RpcError('WATCH_ACTIVE'));
    const subscription = this.#subscription;
    this.#unsubscribeTask = (async () => {
      try {
        const raw = await this.client.request('watch.unsubscribe', { subscription });
        if (!isObject(raw) || raw.ok !== true) throw new RpcError('RPC_PROTOCOL_INVALID');
        this.#subscription = undefined;
      } catch (error) { await this.client.close(); throw error; }
    })().finally(() => { this.#unsubscribeTask = undefined; });
    return this.#unsubscribeTask;
  }
}
