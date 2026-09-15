import { createHmac, randomBytes } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import type { ReadSource, ChatSnapshot, HistorySnapshot, CapabilitySnapshot, AttachmentView, LinkView, ReplyView, ReactionView, PreviewView } from '../shared/web-types.js';
import { AUDIO_TYPES, CONVERTIBLE, IMAGE_TYPES, PREVIEW_TYPE, openAttachment, openAudio, prepareAttachment, type AttachmentFile, type AttachmentSource } from './attachments.js';
import type { ContactPhotos } from './contact-photos.js';
import type { AudioConverter } from './audio-convert.js';
import type { ImageConverter } from './image-convert.js';
import { ReadonlyAdapter, type Attachment, type Reaction } from './readonly-adapter.js';
import { ReadonlyRpcClient } from './rpc/readonly-client.js';
import type { ChildContext } from './child-env.js';
import { isObject } from './rpc/errors.js';
import { capabilities } from './capabilities.js';
import { WebError } from './web-error.js';

type Client = Pick<ReadonlyRpcClient, 'request' | 'close' | 'closed'>;
/**
 * The contact name source must be named explicitly. Upstream picks the
 * AddressBook store only inside an SSH session; under a LaunchAgent it falls to
 * Contacts.framework, where a self-built binary has no grant and no name
 * resolves. The flag comes from imsg-patches/contact-source, so a stock imsg
 * refuses to start rather than silently showing no names.
 */
export const RPC_ARGS = ['rpc', '--contacts-from-address-book'] as const;
/**
 * `status` is reused for this long. The UI asks for capabilities, chats and
 * history every poll, and each used to run its own status, which on a Mac with
 * the Messages bridge installed is an IPC exchange with that bridge. The
 * database identity is still checked on every request, so a replaced chat.db
 * is caught immediately; only readiness and version changes wait for expiry.
 */
export const STATUS_TTL_MS = 60_000;
const OBJECT_REPLACEMENT = '\uFFFC';
/** How many conversations may have their newest message read in one list refresh. */
const PREVIEW_READS = 50;
const MAX_REMEMBERED_PREVIEWS = 2000;
export const PREVIEW_MAX = 100;
const ATTACHMENT_WORD: Record<string, string> = { image: '画像', video: '動画', audio: '音声' };
/** How many of a group's members its row can show at once before the faces stop being faces. */
const FACES_MAX = 4;
/** Servable images remembered per epoch; the oldest are forgotten first. */
export const MAX_REMEMBERED_ATTACHMENTS = 4000;
/** How many of the newest convertible images a history response prepares ahead of viewing. */
export const PREPARE_AHEAD = 20;
/** A reply quote is context, not the message: show enough to recognise it. */
export const REPLY_QUOTE_MAX = 200;
/** How many missing images per history response may be looked up in Messages' preview cache. */
const MAX_PREVIEW_LOOKUPS = 2000;
type FileEntry = { path: string; type: string; root: 'attachments' | 'previews' };
export type SourceOptions = {
  executable: string;
  /** The exact environment and cwd for every imsg child this source starts. */
  context: ChildContext;
  /**
   * The database path imsg must report. Required, and it lives here rather than
   * being derived inside, because the source is what verifies it: an
   * allow-listed environment stops stray variables reaching the child but
   * cannot prove the right HOME was passed, and a wrong one makes imsg open a
   * different chat.db and succeed.
   */
  expectedDatabasePath: string;
  factory?: () => Client;
  /** Converts HEIC and JPEG XL for browsers that cannot draw them. Absent: originals are served. */
  converter?: ImageConverter;
  /** Contact pictures from the address book. Absent: conversations show initials only. */
  photos?: ContactPhotos;
  /** Absent: a voice message that no browser plays is served as it is, for one that can. */
  audio?: AudioConverter;
};
export function clip(text: string, length: number) {
  const cut = text.length > length;
  let value = text.slice(0, length);
  if (cut && /[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return { value, trimmed: cut };
}

export class LiveSource implements ReadSource, AttachmentSource {
  #client: Client | undefined;
  #files = new Map<string, FileEntry>();
  #roots: Partial<Record<FileEntry['root'], Promise<string>>> = {};
  #adapter: ReadonlyAdapter | undefined;
  #identity: string | undefined;
  #status: { raw: unknown; parsed: Awaited<ReturnType<ReadonlyAdapter['status']>>['parsed']; at: number } | undefined;
  #epoch = randomBytes(16).toString('hex');
  #key = randomBytes(32);
  #map = new Map<string, { row: number; guid: string }>();
  /** Newest message per conversation, kept until that conversation's last-message time changes. */
  #previews = new Map<string, { at: string | null; view: PreviewView | null }>();
  /** Contact pictures this epoch has handed out an id for. */
  #avatars = new Map<string, { type: string; bytes: Buffer }>();
  #tail: Promise<unknown> = Promise.resolve();
  #pending = new Map<string, Promise<unknown>>();
  #stopped = false;
  #closeFailed = false;
  #closing: Promise<void> | undefined;
  constructor(private readonly options: SourceOptions) {}
  #id(kind: string, value: string): string { return createHmac('sha256', this.#key).update(`${this.#epoch}:${kind}:${value}`).digest('base64url'); }
  #rotateEpoch() { this.#epoch = randomBytes(16).toString('hex'); this.#map.clear(); this.#files.clear(); this.#previews.clear(); this.#avatars.clear(); }
  async #retire() {
    this.#rotateEpoch(); this.#identity = undefined; this.#status = undefined;
    if (this.#client) {
      try { await this.#client.close(); }
      catch { this.#closeFailed = true; throw new WebError('READER_RECOVERY_REQUIRED'); }
    }
    this.#client = undefined; this.#adapter = undefined;
  }
  #queue<T>(key: string, job: () => Promise<T>): Promise<T> {
    if (this.#stopped || this.#closeFailed) return Promise.reject(new WebError('READER_RECOVERY_REQUIRED'));
    key = `${this.#epoch}:${key}`;
    const shared = this.#pending.get(key); if (shared) return shared as Promise<T>;
    // One active + at most32 distinct waiting operations. Coalesced readers don't allocate another slot.
    if (this.#pending.size >= 33) return Promise.reject(new WebError('BUSY', 429));
    const epoch = this.#epoch;
    const task = this.#tail.then(async () => {
      if (this.#stopped || this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED');
      if (epoch !== this.#epoch) throw new WebError('DB_CHANGED', 409);
      return job();
    }).finally(() => { this.#pending.delete(key); });
    this.#tail = task.catch(() => {}); this.#pending.set(key, task); return task;
  }
  async #fingerprint(path: string): Promise<string> {
    const s = await stat(path, { bigint: true });
    if (!s.isFile()) throw new WebError('DATABASE_UNAVAILABLE');
    return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
  }
  async #context(): Promise<{ raw: unknown; path: string; identity: string; epoch: string; adapter: ReadonlyAdapter }> {
    this.#ensureActive();
    if (this.#client?.closed) await this.#retire();
    this.#ensureActive();
    const fresh = !this.#client;
    if (!this.#client) {
      this.#client = this.#newClient();
      this.#adapter = new ReadonlyAdapter(this.#client as ReadonlyRpcClient);
    }
    const cached = this.#identity !== undefined && this.#status && Date.now() - this.#status.at < STATUS_TTL_MS ? this.#status : undefined;
    const { raw, parsed } = cached ?? await this.#adapter!.status();
    const at = cached?.at ?? Date.now();
    this.#ensureActive();
    const db = isObject(raw) && isObject(raw.database) ? raw.database : undefined;
    // Absolute is not enough. An allow-listed environment stops stray variables
    // reaching the child; it cannot prove the right HOME was passed, and a wrong
    // one makes imsg open a different chat.db and SUCCEED. Verifying the path it
    // reports turns "reads the wrong data" into "fails".
    const reported = typeof db?.path === 'string' && isAbsolute(db.path) ? db.path : undefined;
    const path = reported === this.options.expectedDatabasePath ? reported : undefined;
    if (!path || !parsed.databaseReady) { const established = this.#identity !== undefined; await this.#retire(); throw new WebError(established ? 'DB_CHANGED' : 'DATABASE_UNAVAILABLE', established ? 409 : 503); }
    let identity: string;
    try { identity = `${path}:${await this.#fingerprint(path)}`; }
    catch { const established = this.#identity !== undefined; await this.#retire(); throw new WebError(established ? 'DB_CHANGED' : 'DATABASE_UNAVAILABLE', established ? 409 : 503); }
    this.#ensureActive();
    if (this.#identity !== undefined && identity !== this.#identity) { await this.#retire(); throw new WebError('DB_CHANGED', 409); }
    if (fresh) {
      // Bootstrap only discovers the path. Open the usable reader AFTER its identity
      // has been sampled, so an old handle cannot be labelled with a replacement inode.
      await this.#client!.close().catch(() => { this.#closeFailed = true; throw new WebError('READER_RECOVERY_REQUIRED'); });
      this.#ensureActive();
      this.#client = this.#newClient();
      this.#adapter = new ReadonlyAdapter(this.#client as ReadonlyRpcClient);
      this.#identity = identity; this.#status = { raw, parsed, at };
      return this.#context();
    }
    this.#identity = identity; this.#status = { raw, parsed, at };
    return { raw, path, identity, epoch: this.#epoch, adapter: this.#adapter! };
  }
  /**
   * Where Messages caches the thumbnail of an attachment it has not downloaded:
   * the same relative directory under Caches/Previews, named `<stem>-preview.ktx`.
   * Derived lexically from a path inside Messages/Attachments only; the file is
   * checked again, inside the preview cache, when it is served.
   */
  #previewPath(a: Attachment): string | undefined {
    if (!this.options.converter || !a.missing || !a.type.startsWith('image/') || !isAbsolute(a.path)) return undefined;
    const messages = dirname(this.options.expectedDatabasePath);
    const rel = relative(join(messages, 'Attachments'), a.path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
    const { dir, name } = parse(rel);
    return name ? join(messages, 'Caches', 'Previews', 'Attachments', dir, `${name}-preview.ktx`) : undefined;
  }
  /** Remembers a servable image or recording under an opaque ID; anything else gets no ID. Convertible entries are also collected. */
  #attachmentView(a: Attachment, key: string, previews: ReadonlySet<string>, convertible: FileEntry[]): AttachmentView {
    const kind = a.type.startsWith('image/') ? 'image' : a.type.startsWith('audio/') ? 'audio' : a.type.startsWith('video/') ? 'video' : 'file';
    const preview = this.#previewPath(a);
    let entry: FileEntry | undefined;
    if (preview && previews.has(preview)) entry = { path: preview, type: PREVIEW_TYPE, root: 'previews' };
    else if (kind === 'image' && !a.missing && IMAGE_TYPES.has(a.type) && isAbsolute(a.path)) entry = { path: a.path, type: a.type, root: 'attachments' };
    else if (kind === 'audio' && !a.missing && AUDIO_TYPES.has(a.type) && isAbsolute(a.path)) entry = { path: a.path, type: a.type, root: 'attachments' };
    if (!entry) return { id: null, kind, sticker: a.sticker, preview: false };
    const id = this.#id('attachment', key);
    this.#files.delete(id); this.#files.set(id, entry);
    if (this.#files.size > MAX_REMEMBERED_ATTACHMENTS) this.#files.delete(this.#files.keys().next().value!);
    // Audio is converted when it is played rather than ahead of time: a conversation can hold many
    // voice messages, and the owner listens to one.
    if (CONVERTIBLE.has(entry.type)) convertible.push(entry);
    return { id, kind: AUDIO_TYPES.has(entry.type) ? 'audio' : 'image', sticker: a.sticker, preview: entry.root === 'previews' };
  }
  /** Opaque chat id → the chat's guid, only if it belongs to the current epoch. For the send path. */
  resolveChatGuid(id: string): string | undefined { return this.#map.get(id)?.guid; }
  /** Identical tapbacks collapse into one entry with a count and the names behind it. */
  #reactionViews(list: Reaction[]): ReactionView[] {
    const byKind = new Map<string, ReactionView>();
    for (const reaction of list) {
      const key = `${reaction.kind}:${reaction.emoji}`;
      const seen = byKind.get(key);
      const sender = reaction.sender === null ? null : clip(reaction.sender, 128).value;
      if (seen) {
        seen.count++;
        seen.fromMe ||= reaction.fromMe;
        if (sender !== null && !seen.senders.includes(sender)) seen.senders.push(sender);
      } else {
        byKind.set(key, { emoji: clip(reaction.emoji, 16).value, kind: clip(reaction.kind, 32).value, senders: sender === null ? [] : [sender], fromMe: reaction.fromMe, count: 1 });
      }
    }
    return [...byKind.values()];
  }
  #newClient(): Client {
    return this.options.factory?.() ?? new ReadonlyRpcClient({ executable: this.options.executable, context: this.options.context, args: [...RPC_ARGS] });
  }
  #ensureActive() { if (this.#stopped || this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED'); }
  async #verify(path: string, identity: string, epoch: string) {
    this.#ensureActive();
    let current: string | undefined;
    try { current = `${path}:${await this.#fingerprint(path)}`; } catch { /* rotate below */ }
    if (epoch !== this.#epoch || current !== identity) { await this.#retire(); throw new WebError('DB_CHANGED', 409); }
  }
  chats(limit: number): Promise<ChatSnapshot> {
    return this.#queue(`chats:${limit}`, async () => {
      const c = await this.#context();
      const features = capabilities(c.raw);
      if (features.chats.state !== 'available') throw new WebError(features.chats.reasonCode);
      const rows = await c.adapter.chats(limit);
      // chats.list carries no message text, so the newest message is read per conversation and kept
      // until that conversation moves on. Only so many are read per pass: a long list fills in over
      // a few refreshes rather than making one of them slow. Held in hand as well as remembered, so
      // an epoch rotation below — which forgets what is remembered — still answers this request.
      const shown = new Map<string, PreviewView | null>();
      let budget = PREVIEW_READS;
      for (const row of rows) {
        const held = this.#previews.get(row.guid);
        const view = held && held.at === row.lastMessageAt ? held.view
          : budget-- > 0 ? await this.#preview(c.adapter, row.id) : undefined;
        if (view === undefined) continue; // not read yet; the line stays blank rather than lying
        shown.set(row.guid, view);
        this.#previews.set(row.guid, { at: row.lastMessageAt, view });
      }
      if (this.#previews.size > MAX_REMEMBERED_PREVIEWS) for (const key of [...this.#previews.keys()].slice(0, this.#previews.size - MAX_REMEMBERED_PREVIEWS)) this.#previews.delete(key);
      await this.#verify(c.path, c.identity, c.epoch);
      await this.options.photos?.refresh();
      if (this.#map.size + rows.filter(row => !this.#map.has(this.#id('chat', row.guid))).length > 2000) this.#rotateEpoch();
      return { epoch: this.#epoch, limit, chats: rows.map(row => {
        const id = this.#id('chat', row.guid); this.#map.set(id, { row: row.id, guid: row.guid });
        const name = clip(row.name, 512);
        return { id, name: name.value, service: row.service === 'iMessage' || row.service === 'SMS' ? row.service : 'Other', isGroup: row.isGroup, unreadCount: row.unreadCount, lastMessageAt: row.lastMessageAt, trimmed: name.trimmed, preview: shown.get(row.guid) ?? null, faces: this.#faces(row) };
      }) };
    });
  }
  /**
   * The id of this conversation's contact picture, minted only when the address book has one under
   * exactly that name. The name is imsg's own resolution, so this is the far end of a match that
   * already succeeded; nothing about the contact but the picture crosses into the browser.
   */
  #avatarId(name: string): string | null {
    const photo = name === '' ? undefined : this.options.photos?.get(name);
    if (!photo) return null;
    const id = this.#id('avatar', name);
    this.#avatars.set(id, photo);
    return id;
  }
  /** The same, for a group's member, who reaches this app as a bare handle and no name at all. */
  #handleAvatarId(handle: string): string | null {
    const photo = this.options.photos?.forHandle(handle);
    if (!photo) return null;
    const id = this.#id('avatar', `handle:${handle}`);
    this.#avatars.set(id, photo);
    return id;
  }
  /**
   * The faces a conversation's row wears. A group has no picture of its own, so it wears its
   * members': one slot each, those there is a picture for first — a face earns its place ahead of
   * the order it happened to be listed in. No picture anywhere leaves the row as it always was.
   */
  #faces(row: { isGroup: boolean | null; name: string; participants: string[] }): (string | null)[] {
    if (row.isGroup !== true) { const id = this.#avatarId(row.name); return id === null ? [] : [id]; }
    const slots = row.participants.slice(0, FACES_MAX).map(handle => this.#handleAvatarId(handle));
    slots.sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
    return slots.some(id => id !== null) ? slots : [];
  }
  async avatar(id: string): Promise<{ type: string; size: number; bytes: Buffer }> {
    const photo = this.#avatars.get(id);
    if (!photo) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    return { type: photo.type, size: photo.bytes.length, bytes: photo.bytes };
  }
  /**
   * One line for the conversation list: the newest message's text, or what it carried when it has
   * no text of its own. A read that fails leaves the line empty rather than the list unbuilt.
   */
  async #preview(adapter: ReadonlyAdapter, row: number): Promise<PreviewView | null> {
    const newest = await adapter.history(row, 1).then(rows => rows[0], () => undefined);
    if (!newest) return null;
    const text = clip(newest.text.replaceAll(OBJECT_REPLACEMENT, '').trim(), PREVIEW_MAX);
    if (text.value !== '') return { text: text.value, trimmed: text.trimmed, fromMe: newest.isFromMe };
    const carried = newest.link ? 'リンク' : newest.attachments.some(a => a.sticker) ? 'ステッカー'
      : newest.attachments.length > 0 ? ATTACHMENT_WORD[newest.attachments[0]!.type.split('/')[0] ?? ''] ?? '添付ファイル' : '';
    return carried === '' ? null : { text: carried, trimmed: false, fromMe: newest.isFromMe };
  }
  history(id: string, limit: number): Promise<HistorySnapshot> {
    return this.#queue(`history:${id}:${limit}`, async () => {
      const target = this.#map.get(id); if (!target) throw new WebError('STALE_CHAT', 409);
      const c = await this.#context();
      if (!this.#map.has(id)) throw new WebError('DB_CHANGED', 409);
      if (capabilities(c.raw).history.state !== 'available') throw new WebError('HISTORY_UNAVAILABLE');
      const rows = await c.adapter.history(target.row, limit);
      await this.#verify(c.path, c.identity, c.epoch);
      // Thumbnails for images that were never downloaded, looked up before the rows are mapped.
      const previews = new Set<string>();
      const lookups = [...new Set(rows.flatMap(row => row.attachments.map(a => this.#previewPath(a)).filter((path): path is string => path !== undefined)))].slice(0, MAX_PREVIEW_LOOKUPS);
      await Promise.all(lookups.map(path => lstat(path).then(info => { if (info.isFile()) previews.add(path); }, () => {})));
      const convertible: FileEntry[] = [];
      const snapshot: HistorySnapshot = { epoch: this.#epoch, limit, messages: rows.reverse().map(row => {
        // Messages marks each attachment in the text with U+FFFC. The marker is
        // dropped from the text; attachments are listed separately.
        const attachments: AttachmentView[] = row.attachments.map((a, i) => this.#attachmentView(a, `${row.guid}:${i}`, previews, convertible));
        const markers = Math.min(row.text.split(OBJECT_REPLACEMENT).length - 1, 32);
        while (attachments.length < markers) attachments.push({ id: null, kind: 'file', sticker: false, preview: false });
        let text = clip(row.text.replaceAll(OBJECT_REPLACEMENT, '').trim(), 16384);
        const link: LinkView | null = row.link && {
          url: row.link.url, title: clip(row.link.title, 300).value, summary: clip(row.link.summary, 600).value, siteName: clip(row.link.siteName, 120).value,
          image: row.link.image && this.#attachmentView(row.link.image, `${row.guid}:link`, new Set(), convertible),
        };
        // A message that is only the link says nothing the card does not.
        if (row.link && (text.value === row.link.url || text.value === row.link.originalUrl)) text = { value: '', trimmed: false };
        const sender = row.sender === null ? null : clip(row.sender, 256).value;
        const quote = row.replyTo && clip(row.replyTo.text.replaceAll(OBJECT_REPLACEMENT, '').trim(), REPLY_QUOTE_MAX);
        const replyTo: ReplyView | null = row.replyTo && quote
          // The same id the parent carries when it is in the list: an HMAC over its guid, so the
          // screen can find it without ever being told what it is.
          ? { sender: row.replyTo.sender === null ? null : clip(row.replyTo.sender, 256).value, text: quote.value, trimmed: quote.trimmed, messageId: this.#id('message', row.replyTo.guid) }
          : null;
        return { id: this.#id('message', row.guid), text: text.value, isFromMe: row.isFromMe, sender, avatarId: sender === null ? null : this.#avatarId(sender), attachments, link, replyTo, reactions: this.#reactionViews(row.reactions), createdAt: row.createdAt, trimmed: text.trimmed };
      }) };
      if (this.options.converter && convertible.length > 0) {
        // Newest first, the order the owner meets them in. Checks and conversion happen later, off this queue.
        void this.#prepare(convertible.reverse().slice(0, PREPARE_AHEAD), this.options.converter);
      }
      return snapshot;
    });
  }
  /**
   * Serves an image that a history response in this epoch listed. It does not
   * go through the imsg reader queue: the file is read by this process, and it
   * is checked to be inside the Messages attachments folder or, for a
   * thumbnail, Messages' preview cache.
   */
  #root(kind: FileEntry['root']): Promise<string> {
    const messages = dirname(this.options.expectedDatabasePath);
    const promise = this.#roots[kind] ??= realpath(kind === 'attachments' ? join(messages, 'Attachments') : join(messages, 'Caches', 'Previews'));
    return promise.catch(() => { delete this.#roots[kind]; throw new WebError('ATTACHMENT_UNAVAILABLE', 404); });
  }
  async #prepare(list: FileEntry[], converter: ImageConverter) {
    await Promise.all(list.map(async entry => {
      try { await prepareAttachment(await this.#root(entry.root), entry.path, entry.type, converter); }
      catch { /* preparing is best effort; a view converts on demand */ }
    }));
  }
  async attachment(id: string, accept?: string): Promise<AttachmentFile> {
    this.#ensureActive();
    const file = this.#files.get(id);
    if (!file) throw new WebError('ATTACHMENT_UNAVAILABLE', 404);
    const root = await this.#root(file.root);
    if (AUDIO_TYPES.has(file.type)) return openAudio(root, file.path, file.type, this.options.audio);
    return openAttachment(root, file.path, file.type, this.options.converter && { converter: this.options.converter, accept });
  }
  capabilities(): Promise<CapabilitySnapshot> {
    return this.#queue('capabilities', async () => {
      const c = await this.#context();
      await this.#verify(c.path, c.identity, c.epoch);
      return { epoch: this.#epoch, mode: 'readonly', features: capabilities(c.raw) };
    });
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#stopped = true;
    // Interrupt read-only work, not a mutation. Queued operations observe stopped.
    this.#closing = (async () => { await this.#retire(); await this.#tail; if (this.#closeFailed) throw new WebError('READER_RECOVERY_REQUIRED'); })();
    return this.#closing;
  }
}
