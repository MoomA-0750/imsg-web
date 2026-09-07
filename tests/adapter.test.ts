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
