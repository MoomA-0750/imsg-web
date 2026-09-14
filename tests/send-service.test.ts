import { describe, expect, it, vi } from 'vitest';
import { SendService, TEXT_MAX, type SendMode } from '../src/server/send-service.js';
import type { SendClient, SendReply } from '../src/server/rpc/send-client.js';

function setup(mode: SendMode, reply: SendReply = { ok: true, raw: { ok: true } }) {
  const send = vi.fn<(params: Record<string, unknown>) => Promise<SendReply>>(async () => reply);
  const resolveChatGuid = vi.fn((id: string) => (id === 'known' ? 'chat-guid-1' : undefined));
  const service = new SendService({ mode, resolveChatGuid, clientFactory: () => ({ send } as unknown as SendClient) });
  return { service, send, resolveChatGuid };
}
const base = { chatId: 'known', text: 'Synthetic outgoing' };

describe('SendService (synthetic)', () => {
  it('refuses entirely when off', async () => {
    const { service, send } = setup('off');
    await expect(service.send(base)).rejects.toMatchObject({ code: 'SEND_DISABLED', status: 403 });
    expect(send).not.toHaveBeenCalled();
  });
  it('validates before doing anything, in dry-run too', async () => {
    const { service, send } = setup('dry-run');
    await expect(service.send({ ...base, text: '   ' })).rejects.toMatchObject({ code: 'SEND_EMPTY' });
    await expect(service.send({ ...base, text: 'x'.repeat(TEXT_MAX + 1) })).rejects.toMatchObject({ code: 'SEND_TOO_LONG' });
    await expect(service.send({ text: 'hi' })).rejects.toMatchObject({ code: 'SEND_TARGET_INVALID' });
    await expect(service.send({ chatId: 'known', to: '+15550001111', text: 'hi' })).rejects.toMatchObject({ code: 'SEND_TARGET_INVALID' });
    await expect(service.send({ to: 'not a handle', text: 'hi' })).rejects.toMatchObject({ code: 'SEND_RECIPIENT_INVALID' });
    await expect(service.send({ chatId: 'gone', text: 'hi' })).rejects.toMatchObject({ code: 'STALE_CHAT', status: 409 });
    expect(send).not.toHaveBeenCalled();
  });
  it('resolves the target and validates, but dispatches nothing, in dry-run', async () => {
    const { service, send, resolveChatGuid } = setup('dry-run');
    expect(await service.send(base)).toEqual({ state: 'dry_run' });
    expect(await service.send({ to: 'friend@example.invalid', text: 'hi' })).toEqual({ state: 'dry_run' });
    expect(resolveChatGuid).toHaveBeenCalledWith('known');
    expect(send).not.toHaveBeenCalled();
  });
  it('sends by chat guid with the applescript transport and no attempt id', async () => {
    const { service, send } = setup('live');
    expect(await service.send(base)).toEqual({ state: 'sent' });
    expect(send).toHaveBeenCalledWith({ chat_guid: 'chat-guid-1', text: 'Synthetic outgoing', transport: 'applescript', service: 'auto' });
  });
  it('sends to a validated recipient handle', async () => {
    const { service, send } = setup('live');
    await service.send({ to: '+1 (555) 000-1111', text: 'hi' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: '+1 (555) 000-1111' }));
  });
  it('classifies outcomes by what imsg reports about dispatch', async () => {
    expect(await setup('live', { ok: false, ambiguous: true }).service.send(base)).toEqual({ state: 'unknown' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { retry_safe: true } }).service.send(base)).toEqual({ state: 'failed' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { disposition: 'not_started' } }).service.send(base)).toEqual({ state: 'failed' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32602, message: 'bad', data: 'bad recipient' }).service.send(base)).toEqual({ state: 'failed' });
    // A failure past dispatch, or one imsg does not mark safe, must not claim nothing was sent.
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { disposition: 'dispatched', retry_safe: false } }).service.send(base)).toEqual({ state: 'unknown' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32000, message: 'x', data: undefined }).service.send(base)).toEqual({ state: 'unknown' });
  });
  it('never runs two live sends at once', async () => {
    let active = 0, maxActive = 0;
    const send = vi.fn(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 10)); active--; return { ok: true, raw: {} } as SendReply; });
    const service = new SendService({ mode: 'live', resolveChatGuid: () => 'g', clientFactory: () => ({ send } as unknown as SendClient) });
    await Promise.all([service.send(base), service.send(base), service.send(base)]);
    expect(maxActive).toBe(1);
  });
});
