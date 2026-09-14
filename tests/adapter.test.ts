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
    expect(request).toHaveBeenCalledExactlyOnceWith('messages.history', { chat_id: 42, limit: 1, attachments: false });
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
