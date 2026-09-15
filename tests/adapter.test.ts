import { describe, expect, it, vi } from 'vitest';
import { ReadonlyAdapter } from '../src/server/readonly-adapter.js';
import type { ReadonlyRpcClient } from '../src/server/rpc/readonly-client.js';

function setup() {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();
  const close = vi.fn(async () => {});
  return { request, close, adapter: new ReadonlyAdapter({ request, close } as unknown as ReadonlyRpcClient) };
}
describe('readonly adapter contracts (synthetic)', () => {
  it('coalesces concurrent unsubscribe calls so an old ACK cannot clear a new subscription', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValueOnce({ subscription: 1 }); await adapter.subscribe();
    let complete!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const a = adapter.unsubscribe(); const b = adapter.unsubscribe();
    expect(a).toBe(b);
    expect(request.mock.calls.filter(call => call[0] === 'watch.unsubscribe')).toHaveLength(1);
    await expect(adapter.subscribe()).rejects.toMatchObject({ code: 'WATCH_ACTIVE' });
    complete({ ok: true }); await Promise.all([a, b]);
    request.mockResolvedValueOnce({ subscription: 2 }); await adapter.subscribe();
    request.mockResolvedValueOnce({ ok: true }); await adapter.unsubscribe();
    expect(request).toHaveBeenLastCalledWith('watch.unsubscribe', { subscription: 2 });
  });

  it('bounds limits and rejects invalid IDs without dispatch', async () => {
    const { adapter, request } = setup();
    await expect(adapter.chats(1001)).rejects.toMatchObject({ code: 'PARAMS_INVALID' });
    await expect(adapter.history(0)).rejects.toMatchObject({ code: 'PARAMS_INVALID' });
    expect(request).not.toHaveBeenCalled();
  });
  it('does not return a history from a different chat', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ messages: [{ id: 2, chat_id: 999, guid: 'synthetic', text: 'Synthetic', is_from_me: false }] });
    await expect(adapter.history(42, 1)).rejects.toMatchObject({ code: 'RPC_PROTOCOL_INVALID' });
    expect(request).toHaveBeenCalledExactlyOnceWith('messages.history', { chat_id: 42, limit: 1, attachments: true, convert_attachments: false });
  });
  it('prefers a chat title, then the resolved contact name, then the raw handle', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ chats: [
      { id: 1, guid: 'g1', service: 'iMessage', name: 'Synthetic group title', identifier: 'chat-synthetic', contact_name: 'Ignored' },
      { id: 2, guid: 'g2', service: 'iMessage', name: '+15550000001', identifier: '+15550000001', contact_name: 'Synthetic Person' },
      { id: 3, guid: 'g3', service: 'SMS', name: '+15550000002', identifier: '+15550000002' },
      { id: 4, guid: 'g4', service: 'SMS', name: '', identifier: '' },
    ] });
    expect((await adapter.chats(4)).map(chat => chat.name)).toEqual(['Synthetic group title', 'Synthetic Person', '+15550000002', '名前のない会話']);
  });
  it('names the sender of received messages only, preferring the resolved name', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ messages: [
      { id: 3, chat_id: 7, guid: 'm3', text: 'a', is_from_me: false, sender: '+15550000001', sender_name: 'Synthetic Person' },
      { id: 2, chat_id: 7, guid: 'm2', text: 'b', is_from_me: false, sender: 'synthetic@example.invalid' },
      { id: 1, chat_id: 7, guid: 'm1', text: 'c', is_from_me: true, sender: '+15550000009', sender_name: 'Owner' },
    ] });
    expect((await adapter.history(7, 3)).map(message => message.sender)).toEqual(['Synthetic Person', 'synthetic@example.invalid', null]);
  });
  it('keeps only the attachment fields it needs, skips link previews, treats unknown presence as missing, and bounds the list', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ messages: [
      { id: 2, chat_id: 7, guid: 'm2', text: '', is_from_me: false, attachments: [
        { original_path: '/synthetic/Attachments/a.HEIC', mime_type: 'Image/HEIC', missing: false, is_sticker: false, transfer_name: 'dropped.heic', total_bytes: 1 },
        { original_path: '/synthetic/Attachments/b.png', mime_type: 'image/png', is_sticker: true },
        'not an object',
        { filename: '~/Library/Messages/Attachments/x/y/Synthetic.pluginPayloadAttachment', original_path: '/synthetic/Attachments/link', mime_type: '', missing: false },
      ] },
      { id: 1, chat_id: 7, guid: 'm1', text: 'x', is_from_me: true, attachments: Array.from({ length: 40 }, () => ({ original_path: '/p', mime_type: 'image/png', missing: false })) },
    ] });
    const [first, second] = await adapter.history(7, 2);
    expect(first!.attachments).toEqual([
      { path: '/synthetic/Attachments/a.HEIC', type: 'image/heic', missing: false, sticker: false },
      { path: '/synthetic/Attachments/b.png', type: 'image/png', missing: true, sticker: true },
    ]);
    expect(second!.attachments).toHaveLength(32);
  });
  it('calls audio by one name however it was written down, and by its UTI when it has no name', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ messages: [
      { id: 1, chat_id: 7, guid: 'm1', text: '', is_from_me: true, attachments: [
        // What Messages records for a file this app sent itself.
        { original_path: '/synthetic/Attachments/sent.m4a', mime_type: 'audio/x-m4a', uti: 'com.apple.m4a-audio', missing: false },
        { original_path: '/synthetic/Attachments/note.wav', mime_type: 'AUDIO/X-WAV', missing: false },
        // A voice message: no mime type at all, only the UTI.
        { original_path: '/synthetic/Attachments/voice.caf', mime_type: '', uti: 'com.apple.coreaudio-format', missing: false },
        // Not audio, and not to be renamed by any of this.
        { original_path: '/synthetic/Attachments/clip.mp4', mime_type: 'video/mp4', uti: 'public.mpeg-4', missing: false },
        { original_path: '/synthetic/Attachments/odd', mime_type: '', uti: 'dyn.synthetic', missing: false },
        // A name nothing here knows: the UTI macOS wrote is the better answer.
        { original_path: '/synthetic/Attachments/strange.m4a', mime_type: 'audio/synthetic-unknown', uti: 'com.apple.m4a-audio', missing: false },
      ] },
    ] });
    const [message] = await adapter.history(7, 1);
    expect(message!.attachments.map(a => a.type)).toEqual(['audio/mp4', 'audio/wav', 'audio/x-caf', 'video/mp4', '', 'audio/mp4']);
  });

  it('accepts a link preview only with an absolute http(s) URL', async () => {
    const { adapter, request } = setup();
    const message = (id: number, link_preview: unknown) => ({ id, chat_id: 7, guid: `m${id}`, text: '', is_from_me: false, link_preview });
    request.mockResolvedValue({ messages: [
      message(6, { url: 'https://example.invalid/p', original_url: 'http://example.invalid/o', title: 'T', summary: 'S', site_name: 'N', image: { original_path: '/synthetic/i', mime_type: 'image/jpeg', missing: false } }),
      message(5, { url: 'javascript:alert(1)', original_url: 'https://example.invalid/fallback' }),
      message(4, { url: 'javascript:alert(1)' }),
      message(3, { url: 'https://user:secret@example.invalid/' }),
      message(2, { url: `https://example.invalid/${'x'.repeat(2100)}` }),
      message(1, 'not an object'),
    ] });
    const links = (await adapter.history(7, 6)).map(m => m.link);
    expect(links[0]).toEqual({ url: 'https://example.invalid/p', originalUrl: 'http://example.invalid/o', title: 'T', summary: 'S', siteName: 'N', image: { path: '/synthetic/i', type: 'image/jpeg', missing: false, sticker: false } });
    expect(links[1]).toMatchObject({ url: 'https://example.invalid/fallback', title: '', image: null });
    expect(links.slice(2)).toEqual([null, null, null, null]);
  });
  it('carries a threaded reply and the tapbacks on it, and neither a chained reply_to_guid nor an unresolved parent', async () => {
    const { adapter, request } = setup();
    request.mockResolvedValue({ messages: [
      { id: 3, chat_id: 7, guid: 'm3', text: 'a', is_from_me: false,
        thread_originator_guid: 'parent-guid', reply_to_guid: 'parent-guid',
        reply_to_text: '元のメッセージ', reply_to_sender: '合成送信者 Alpha',
        reactions: [
          { id: 1, type: 'love', emoji: '❤️', sender: '+15550000001', sender_name: '合成送信者 Alpha', is_from_me: false },
          { id: 2, type: 'like', emoji: '👍', sender: '+15550000002', is_from_me: false },
          { id: 3, type: 'like', emoji: '👍', sender: '+15550000009', is_from_me: true },
          'not an object',
          { id: 4, type: '', emoji: '' },
        ] },
      // A reply whose parent imsg could not resolve carries no quote to show.
      { id: 2, chat_id: 7, guid: 'm2', text: 'b', is_from_me: false, thread_originator_guid: 'gone', reply_to_guid: 'gone', reply_to_text: '' },
      // Not a reply: Messages chains reply_to_guid across consecutive messages, and imsg
      // resolves the text of that neighbour. Without a thread originator it stays unquoted.
      { id: 1, chat_id: 7, guid: 'm1', text: 'c', is_from_me: true, reply_to_guid: 'm0', reply_to_text: '直前のメッセージ', reply_to_sender: '合成送信者 Beta' },
    ] });
    const [first, second, third] = await adapter.history(7, 3);
    expect(first!.replyTo).toEqual({ sender: '合成送信者 Alpha', text: '元のメッセージ' });
    expect(first!.reactions).toEqual([
      { kind: 'love', emoji: '❤️', sender: '合成送信者 Alpha', fromMe: false },
      { kind: 'like', emoji: '👍', sender: '+15550000002', fromMe: false },
      { kind: 'like', emoji: '👍', sender: null, fromMe: true },
    ]);
    expect(second!.replyTo).toBeNull();
    expect(third!.replyTo).toBeNull();
    expect(third!.reactions).toEqual([]);
  });
  it('allows only one pending or active subscription', async () => {
    const { adapter, request } = setup();
    let complete!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = adapter.subscribe();
    await expect(adapter.subscribe()).rejects.toMatchObject({ code: 'WATCH_ACTIVE' });
    complete({ subscription: 1 }); await first;
    await expect(adapter.subscribe()).rejects.toMatchObject({ code: 'WATCH_ACTIVE' });
    request.mockResolvedValue({ ok: true }); await adapter.unsubscribe();
    expect(request).toHaveBeenLastCalledWith('watch.unsubscribe', { subscription: 1 });
  });
  it('closes the read-only child on a malformed subscribe response', async () => {
    const { adapter, request, close } = setup();
    request.mockResolvedValue({ subscription: 'unknown' });
    await expect(adapter.subscribe()).rejects.toMatchObject({ code: 'RPC_PROTOCOL_INVALID' });
    expect(close).toHaveBeenCalledOnce();
  });
});
