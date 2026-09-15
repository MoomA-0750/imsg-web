import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, rename, symlink, writeFile, rm, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveSource, STATUS_TTL_MS, REPLY_QUOTE_MAX, clip } from '../src/server/live-source.js';
import { testContext } from './helpers/child-context.js';
import type { ImageConverter } from '../src/server/image-convert.js';
const { forbiddenCli, forbiddenSpawn } = vi.hoisted(() => ({ forbiddenCli: vi.fn(), forbiddenSpawn: vi.fn() }));
vi.mock('../src/server/cli-status.js', () => ({ cliStatus: forbiddenCli }));
vi.mock('node:child_process', () => ({ spawn: forbiddenSpawn }));

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function setup(attachments: (dir: string) => unknown[] = () => [], extra: (dir: string) => Record<string, unknown> = () => ({}), converter?: ImageConverter) {
  const dir = await mkdtemp(join(tmpdir(), 'iw-source-')), path = join(dir, 'chat.db');
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path, 'old');
  const handles: FileHandle[] = [], calls: string[] = [];
  let created = 0, living = 0, maximum = 0, failClose = false, offset = 0;
  let hold: ReturnType<typeof deferred<void>> | undefined;
  let beforeStatus: (() => Promise<void>) | undefined;
  const status = () => ({ version: '0.15.1', protocol_version: 1, database: { ready: true, path }, bridge: { ready: false }, contacts: { available: false }, methods: ['status', 'chats.list', 'messages.history'] });
  const factory = () => {
    created++; living++; maximum = Math.max(maximum, living);
    let closed = false;
    const handle = open(path).then(h => { handles.push(h); return h; });
    return { get closed() { return closed; }, async close() {
      if (failClose) throw new Error('synthetic close failure');
      if (!closed) { closed = true; living--; await (await handle).close(); }
    }, async request(method: string, params: Record<string, unknown> = {}) {
      calls.push(method);
      if (method === 'status') { await handle; if (beforeStatus) { const task = beforeStatus; beforeStatus = undefined; await task(); } return status(); }
      await hold?.promise;
      if (closed) throw new Error('reader closed');
      if (method === 'chats.list') return { chats: Array.from({ length: Number(params.limit) }, (_, i) => ({ id: offset + i + 1, guid: `chat-${offset + i}`, name: '', identifier: 'Synthetic conversation', service: 'iMessage' })) };
      if (method === 'messages.history') {
        const buffer = Buffer.alloc(16); const { bytesRead } = await (await handle).read(buffer, 0, 16, 0);
        return { messages: [{ id: 2, chat_id: params.chat_id, guid: 'm-2', text: buffer.subarray(0, bytesRead).toString(), is_from_me: false, attachments: attachments(dir), ...extra(dir) }, { id: 1, chat_id: params.chat_id, guid: 'm-1', text: 'earlier', is_from_me: true }] };
      }
      throw new Error('unexpected method');
    } };
  };
  const source = new LiveSource({ context: testContext(), executable: '/synthetic/imsg', expectedDatabasePath: path, factory, ...(converter ? { converter } : {}) });
  cleanups.push(async () => { failClose = false; hold?.resolve(); await source.close().catch(() => {}); for (const h of handles) await h.close().catch(() => {}); });
  const replace = async () => { await writeFile(join(dir, 'replacement'), 'new'); await rename(join(dir, 'replacement'), path); };
  return { source, calls, dir, path, replace, removeDB: () => unlink(path), get created() { return created; }, get maximum() { return maximum; }, setOffset: (n: number) => { offset = n; }, setFailClose: () => { failClose = true; }, hold: () => { hold = deferred<void>(); return hold; }, onStatus: (task: () => Promise<void>) => { beforeStatus = task; } };
}
describe('B04 DB generation and reader lifetime', () => {
  it('bootstraps only path then opens a reader after stat, keeps raw IDs private, reverses history, keeps unknown fields null', async () => {
    const f = await setup(); f.onStatus(f.replace);
    const chats = await f.source.chats(50);
    expect(f.created).toBe(2); expect(f.maximum).toBe(1);
    const c = chats.chats[0]!;
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(c).toMatchObject({ name: 'Synthetic conversation', unreadCount: null, isGroup: null, lastMessageAt: null });
    const history = await f.source.history(c.id, 50);
    expect(history.messages.map(m => m.text)).toEqual(['earlier', 'new']);
    expect(JSON.stringify(chats)).not.toContain('chat-0');
  });
  it('rejects inode replacement with an old handle and never transfers old opaque ID to reused rowid', async () => {
    const f = await setup(); const old = await f.source.chats(50);
    await f.replace();
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'DB_CHANGED', status: 409 });
    const fresh = await f.source.chats(50);
    expect(fresh.epoch).not.toBe(old.epoch); expect(f.maximum).toBe(1);
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT' });
    expect((await f.source.history(fresh.chats[0]!.id, 50)).messages[1]!.text).toBe('new');
  });
  it('discards a result if inode changes during the read', async () => {
    const f = await setup(); const old = await f.source.chats(50), gate = f.hold();
    const pending = f.source.history(old.chats[0]!.id, 50);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'DB_CHANGED' });
    await vi.waitFor(() => expect(f.calls).toContain('messages.history'));
    await f.replace(); gate.resolve(); await assertion;
  });
  it('returns409 when an established DB disappears and invalidates the old ID', async () => {
    const f = await setup(); const old = await f.source.chats(50); await f.removeDB();
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'DB_CHANGED', status: 409 });
    await expect(f.source.history(old.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT', status: 409 });
  });
  it('coalesces only equal requests; bounds one active plus32 waiting and refuses recovery after failed close', async () => {
    const f = await setup(); await f.source.chats(50); const gate = f.hold();
    const a = f.source.chats(50); expect(f.source.chats(50)).toBe(a);
    const jobs = [a, ...Array.from({ length: 32 }, (_, i) => f.source.chats(i + 51))];
    await expect(f.source.chats(999)).rejects.toMatchObject({ code: 'BUSY', status: 429 });
    gate.resolve(); await Promise.all(jobs);
    const count = f.created; f.setFailClose(); await f.replace();
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    expect(f.created).toBe(count);
  });
  it('rotates at map entry2001, keeps same-epoch IDs stable, and shutdown cannot spawn another child', async () => {
    const f = await setup(); const first = await f.source.chats(1000);
    expect((await f.source.chats(50)).chats[0]!.id).toBe(first.chats[0]!.id);
    f.setOffset(1000); expect((await f.source.chats(1000)).epoch).toBe(first.epoch);
    f.setOffset(2000); const next = await f.source.chats(50); expect(next.epoch).not.toBe(first.epoch);
    await expect(f.source.history(first.chats[0]!.id, 50)).rejects.toMatchObject({ code: 'STALE_CHAT' });
    const count = f.created; const a = f.source.close(); expect(f.source.close()).toBe(a); await a;
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' }); expect(f.created).toBe(count);
  });
  it('drops attachment markers from the text and still lists an attachment imsg did not describe', async () => {
    const f = await setup(); const chats = await f.source.chats(1);
    await writeFile(f.path, ' look \uFFFC\uFFFC'); // same inode, so the reader sees new bytes without a DB change
    const [latest, earlier] = (await f.source.history(chats.chats[0]!.id, 50)).messages.reverse();
    expect(latest).toMatchObject({ text: 'look', attachments: [{ id: null, kind: 'file', sticker: false, preview: false }, { id: null, kind: 'file', sticker: false, preview: false }], sender: null });
    expect(earlier).toMatchObject({ text: 'earlier', attachments: [] });
  });
  it('gives an ID only to a present image of an allowed type, and serves it only from inside Attachments', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'iw-outside-'));
    cleanups.push(() => rm(outside, { recursive: true, force: true }));
    const f = await setup(dir => [
      { original_path: join(dir, 'Attachments', 'ok.png'), mime_type: 'image/png', missing: false },
      { original_path: join(dir, 'Attachments', 'gone.jpg'), mime_type: 'image/jpeg', missing: true },
      { original_path: join(dir, 'Attachments', 'vector.svg'), mime_type: 'image/svg+xml', missing: false },
      { original_path: join(dir, 'Attachments', 'clip.mov'), mime_type: 'video/quicktime', missing: false },
      { original_path: join(dir, 'Attachments', 'escape.png'), mime_type: 'image/png', missing: false },
      { original_path: join(outside, 'secret.png'), mime_type: 'image/png', missing: false },
      { original_path: join(dir, 'Attachments', 'dir.png'), mime_type: 'image/png', missing: false },
      { original_path: join(dir, 'Attachments', 'page.jpg'), mime_type: 'image/jpeg', missing: false },
    ]);
    await mkdir(join(f.dir, 'Attachments', 'dir.png'), { recursive: true });
    await writeFile(join(f.dir, 'Attachments', 'ok.png'), Buffer.concat([PNG_SIGNATURE, Buffer.from('DATA')]));
    await writeFile(join(f.dir, 'Attachments', 'page.jpg'), '<!DOCTYPE html><script>synthetic</script>');
    await writeFile(join(outside, 'secret.png'), 'SECRET');
    await symlink(join(outside, 'secret.png'), join(f.dir, 'Attachments', 'escape.png'));
    const chats = await f.source.chats(1);
    const [message] = (await f.source.history(chats.chats[0]!.id, 50)).messages.slice(-1);
    const list = message!.attachments;
    expect(list.map(a => [a.kind, a.id !== null])).toEqual([['image', true], ['image', false], ['image', false], ['video', false], ['image', true], ['image', true], ['image', true], ['image', true]]);
    expect(JSON.stringify(list)).not.toContain(f.dir);
    const served = await f.source.attachment(list[0]!.id!);
    expect(served).toMatchObject({ type: 'image/png', size: 12 });
    expect(Buffer.concat(await served.stream.toArray()).subarray(8).toString()).toBe('DATA');
    for (const index of [4, 5, 6, 7]) await expect(f.source.attachment(list[index]!.id!)).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE', status: 404 });
    await expect(f.source.attachment('Z'.repeat(43))).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE', status: 404 });
    await f.replace(); await expect(f.source.chats(1)).rejects.toMatchObject({ code: 'DB_CHANGED' });
    await expect(f.source.attachment(list[0]!.id!)).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' }); // a new epoch forgets old IDs
  });
  it('turns a stored link preview into a card, drops a text that is only the link, and serves its image like an attachment', async () => {
    const f = await setup(() => [], dir => ({ link_preview: {
      url: 'https://example.invalid/article', original_url: 'https://x.test/a', title: 'Synthetic title', summary: 'S'.repeat(700), site_name: 'Synthetic site',
      image: { original_path: join(dir, 'Attachments', 'preview.pluginPayloadAttachment'), mime_type: 'image/png', missing: false },
    } }));
    await mkdir(join(f.dir, 'Attachments'), { recursive: true });
    await writeFile(join(f.dir, 'Attachments', 'preview.pluginPayloadAttachment'), Buffer.concat([PNG_SIGNATURE, Buffer.from('DATA')]));
    const chats = await f.source.chats(1);
    await writeFile(f.path, 'https://x.test/a'); // same inode, and within the 16 bytes the fixture reads: the text is only the original link
    const message = (await f.source.history(chats.chats[0]!.id, 50)).messages.at(-1)!;
    expect(message.text).toBe('');
    expect(message.link).toMatchObject({ url: 'https://example.invalid/article', title: 'Synthetic title', siteName: 'Synthetic site' });
    expect(message.link!.summary).toHaveLength(600);
    expect(JSON.stringify(message)).not.toContain(f.dir);
    expect((await f.source.attachment(message.link!.image!.id!)).type).toBe('image/png');
  });
  it('offers Messages thumbnails for images never downloaded, and prepares HEIC and thumbnails in the background', async () => {
    const HEIC = Buffer.concat([Buffer.from('000000186674797068656963', 'hex'), Buffer.from('synthetic')]);
    const convert = vi.fn(async () => Buffer.from('converted'));
    const converter = { has: () => false, convert } as unknown as ImageConverter;
    const f = await setup(dir => [
      { original_path: join(dir, 'Attachments', 'photo.heic'), mime_type: 'image/heic', missing: false },
      { original_path: join(dir, 'Attachments', 'gone.heic'), mime_type: 'image/heic', missing: true },
      { original_path: join(dir, 'Attachments', 'plain.png'), mime_type: 'image/png', missing: false },
      { original_path: join(dir, 'Attachments', 'aa', '01', 'SYN-GUID', 'IMG_1.HEIC'), mime_type: 'image/heic', missing: true },
      { original_path: join(dir, 'Attachments', 'aa', '01', 'SYN-GUID', 'IMG_2.JPG'), mime_type: 'image/jpeg', missing: true },
      { original_path: join(dir, 'Elsewhere', 'IMG_3.HEIC'), mime_type: 'image/heic', missing: true },
      { original_path: join(dir, 'Attachments', '..', 'Caches', 'Previews', 'Attachments', 'IMG_4.HEIC'), mime_type: 'image/heic', missing: true },
    ], () => ({}), converter);
    await mkdir(join(f.dir, 'Attachments'), { recursive: true });
    await writeFile(join(f.dir, 'Attachments', 'photo.heic'), HEIC);
    await writeFile(join(f.dir, 'Attachments', 'plain.png'), PNG_SIGNATURE);
    const previews = join(f.dir, 'Caches', 'Previews', 'Attachments');
    await mkdir(join(previews, 'aa', '01', 'SYN-GUID'), { recursive: true });
    const AAPL = Buffer.concat([Buffer.from('AAPL\r\n\x1a\n', 'latin1'), Buffer.from('synthetic')]);
    await writeFile(join(previews, 'aa', '01', 'SYN-GUID', 'IMG_1-preview.ktx'), AAPL);
    await writeFile(join(previews, 'IMG_3-preview.ktx'), AAPL); // would match only a path outside Attachments
    await writeFile(join(previews, 'IMG_4-preview.ktx'), AAPL);
    const chats = await f.source.chats(1);
    const message = (await f.source.history(chats.chats[0]!.id, 50)).messages.at(-1)!;
    expect(message.attachments.map(a => [a.id !== null, a.preview])).toEqual([[true, false], [false, false], [true, false], [true, true], [false, false], [false, false], [false, false]]);
    expect(JSON.stringify(message)).not.toContain('SYN-GUID');
    await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
    expect(convert).toHaveBeenCalledWith(expect.stringContaining('IMG_1-preview.ktx'), expect.any(Function), 'image/x-apple-preview', true);
    expect(convert).toHaveBeenCalledWith(expect.stringContaining('photo.heic'), expect.any(Function), 'image/heic', true);
    expect((await f.source.attachment(message.attachments[3]!.id!, 'image/avif,*/*')).type).toBe('image/jpeg');
  });
  it('quotes the replied-to message and folds identical tapbacks into one, without leaking identifiers', async () => {
    const f = await setup(() => [], () => ({
      thread_originator_guid: 'parent-guid-SECRET', reply_to_text: `${'長'.repeat(REPLY_QUOTE_MAX + 20)}\uFFFC`, reply_to_sender: '合成送信者 Alpha',
      reactions: [
        { id: 1, type: 'love', emoji: '❤️', sender: '+15550000001', sender_name: '合成送信者 Alpha', is_from_me: false },
        { id: 2, type: 'love', emoji: '❤️', sender: '+15550000002', sender_name: '合成送信者 Beta', is_from_me: false },
        { id: 3, type: 'love', emoji: '❤️', sender: '+15550000009', is_from_me: true },
        { id: 4, type: 'like', emoji: '👍', sender: '+15550000003', sender_name: '合成送信者 Gamma', is_from_me: false },
      ],
    }));
    const chats = await f.source.chats(1);
    const message = (await f.source.history(chats.chats[0]!.id, 50)).messages.at(-1)!;
    expect(message.replyTo).toMatchObject({ sender: '合成送信者 Alpha', trimmed: true });
    expect(message.replyTo!.text).toHaveLength(REPLY_QUOTE_MAX);
    expect(message.replyTo!.text).not.toContain('\uFFFC'); // the attachment marker is not part of the quote
    expect(message.reactions).toEqual([
      { emoji: '❤️', kind: 'love', senders: ['合成送信者 Alpha', '合成送信者 Beta'], fromMe: true, count: 3 },
      { emoji: '👍', kind: 'like', senders: ['合成送信者 Gamma'], fromMe: false, count: 1 },
    ]);
    expect(JSON.stringify(message)).not.toContain('parent-guid-SECRET');
  });
  it('does not split surrogate pairs when clipping', () => { expect(clip('a😀b', 2)).toEqual({ value: 'a', trimmed: true }); expect(clip('😀', 2).trimmed).toBe(false); });
  it('keeps capabilities and concurrent reads free of CLI probes after the former cache interval', async () => {
    const f = await setup();
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(100_000);
      expect((await f.source.capabilities()).features.read).toEqual({ state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' });
      const chats = await f.source.chats(50);
      clock.mockReturnValue(131_001);
      await Promise.all([f.source.capabilities(), f.source.capabilities(), f.source.chats(50), f.source.history(chats.chats[0]!.id, 50)]);
      expect(f.calls).toContain('messages.history');
      expect(f.calls.every(method => ['status', 'chats.list', 'messages.history'].includes(method))).toBe(true);
      expect(forbiddenCli).not.toHaveBeenCalled();
      expect(forbiddenSpawn).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it('runs one status per status interval, not one per request', async () => {
    const f = await setup();
    const clock = vi.spyOn(Date, 'now');
    const statuses = () => f.calls.filter(method => method === 'status').length;
    try {
      clock.mockReturnValue(1_000_000);
      const chats = await f.source.chats(50);
      await f.source.capabilities(); await f.source.history(chats.chats[0]!.id, 50);
      expect(statuses()).toBe(1);
      clock.mockReturnValue(1_000_000 + STATUS_TTL_MS - 1);
      await f.source.capabilities();
      expect(statuses()).toBe(1);
      clock.mockReturnValue(1_000_000 + STATUS_TTL_MS);
      await f.source.capabilities(); await f.source.chats(50);
      expect(statuses()).toBe(2);
    } finally { clock.mockRestore(); }
  });
  it('still catches a replaced database while status is being reused, and asks again afterwards', async () => {
    const f = await setup(); const old = await f.source.chats(50);
    await f.replace();
    await expect(f.source.chats(50)).rejects.toMatchObject({ code: 'DB_CHANGED', status: 409 });
    const before = f.calls.filter(method => method === 'status').length;
    const fresh = await f.source.chats(50);
    expect(fresh.epoch).not.toBe(old.epoch);
    expect(f.calls.filter(method => method === 'status').length).toBeGreaterThan(before);
  });
  it('does not report clean shutdown after RPC close fails during capability bootstrap', async () => {
    const f = await setup(); f.setFailClose();
    await expect(f.source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    const created = f.created;
    await expect(f.source.capabilities()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    await expect(f.source.close()).rejects.toMatchObject({ code: 'READER_RECOVERY_REQUIRED' });
    expect(f.created).toBe(created);
  });
});
