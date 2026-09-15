import { describe, expect, it, vi } from 'vitest';
import { SendService, TEXT_MAX, FILES_MAX, type SendMode } from '../src/server/send-service.js';
import type { SendClient, SendReply } from '../src/server/rpc/send-client.js';

function setup(mode: SendMode, reply: SendReply = { ok: true, raw: { ok: true } }) {
  const send = vi.fn<(params: Record<string, unknown>) => Promise<SendReply>>(async () => reply);
  const resolveChatGuid = vi.fn((id: string) => (id === 'known' ? 'chat-guid-1' : undefined));
  const reported: string[] = [];
  const service = new SendService({ mode, resolveChatGuid, clientFactory: () => ({ send } as unknown as SendClient), report: line => reported.push(line) });
  return { service, send, resolveChatGuid, reported };
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
  it('writes down why a send did not go, in shapes only, and says nothing when one does', async () => {
    const fine = setup('live');
    await fine.service.send(base);
    expect(fine.reported).toEqual([]); // a send that works is not news

    const lost = setup('live', { ok: false, ambiguous: true, why: 'closed', note: 'error: cannot open <path>' });
    await lost.service.send(base);
    expect(lost.reported).toHaveLength(1);
    expect(lost.reported[0]).toContain('state=unknown');
    expect(lost.reported[0]).toContain('lost=closed');
    expect(lost.reported[0]).toContain('said="error: cannot open <path>"');
    expect(lost.reported[0]).toContain('attachment=no');

    const refused = setup('live', { ok: false, ambiguous: false, code: -32603, message: 'Messages automation failed with AppleScript error -1728.', data: { retry_safe: true, disposition: 'not_started', transport: 'applescript' } });
    await refused.service.send(base);
    expect(refused.reported[0]).toContain('state=failed');
    expect(refused.reported[0]).toContain('code=-32603');
    expect(refused.reported[0]).toContain('disposition=not_started');
    expect(refused.reported[0]).toContain('retry_safe=true');
    expect(refused.reported[0]).toContain('applescript=-1728');
    // What was being sent, and who to, is never any part of it.
    expect(refused.reported[0]).not.toContain('Synthetic outgoing');
    expect(refused.reported[0]).not.toContain('chat-guid-1');
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
    expect(await setup('live', { ok: false, ambiguous: true, why: 'closed' }).service.send(base)).toEqual({ state: 'unknown' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { retry_safe: true } }).service.send(base)).toEqual({ state: 'failed' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { disposition: 'not_started' } }).service.send(base)).toEqual({ state: 'failed' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32602, message: 'bad', data: 'bad recipient' }).service.send(base)).toEqual({ state: 'failed' });
    // A failure past dispatch, or one imsg does not mark safe, must not claim nothing was sent.
    expect(await setup('live', { ok: false, ambiguous: false, code: -32603, message: 'x', data: { disposition: 'dispatched', retry_safe: false } }).service.send(base)).toEqual({ state: 'unknown' });
    expect(await setup('live', { ok: false, ambiguous: false, code: -32000, message: 'x', data: undefined }).service.send(base)).toEqual({ state: 'unknown' });
  });
  it('sends attachments one message at a time, stopping honestly, and always cleans them up', async () => {
    const upload = (name: string) => ({ id: name, dir: `/tmp/${name}`, path: `/tmp/${name}/${name}.jpg`, name: `${name}.jpg`, bytes: 3, created: 0 });
    const make = (mode: SendMode, replies: SendReply[] = []) => {
      let call = 0;
      const send = vi.fn<(params: Record<string, unknown>) => Promise<SendReply>>(async () => replies[call++] ?? { ok: true, raw: {} });
      const discard = vi.fn(async () => {});
      const take = vi.fn((id: string) => (id.startsWith('f') ? upload(id) : undefined));
      const service = new SendService({ mode, resolveChatGuid: () => 'chat-guid-1', clientFactory: () => ({ send } as unknown as SendClient), uploads: { take, discard } });
      return { service, send, discard };
    };

    // The text rides with the first file; the rest are file-only messages.
    const batch = make('live');
    expect(await batch.service.send({ chatId: 'known', text: '見て', uploadIds: ['f1', 'f2', 'f3'] })).toEqual({ state: 'sent', sent: 3, total: 3 });
    expect(batch.send).toHaveBeenCalledTimes(3);
    expect(batch.send.mock.calls[0]![0]).toEqual({ chat_guid: 'chat-guid-1', text: '見て', file: '/tmp/f1/f1.jpg', transport: 'applescript', service: 'auto' });
    expect(batch.send.mock.calls[1]![0]).toMatchObject({ text: '', file: '/tmp/f2/f2.jpg' });
    expect(batch.discard).toHaveBeenCalledTimes(3);

    const single = make('live');
    expect(await single.service.send({ chatId: 'known', uploadIds: ['f1'] })).toEqual({ state: 'sent', sent: 1, total: 1 });
    expect(single.send).toHaveBeenCalledWith(expect.objectContaining({ text: '', file: '/tmp/f1/f1.jpg' }));

    // A batch stops at the first attachment that did not go, and says how far it got.
    const stopped = make('live', [{ ok: true, raw: {} }, { ok: false, ambiguous: false, code: -32603, message: 'x', data: { retry_safe: true } }]);
    expect(await stopped.service.send({ chatId: 'known', uploadIds: ['f1', 'f2', 'f3'] })).toEqual({ state: 'failed', sent: 1, total: 3 });
    expect(stopped.send).toHaveBeenCalledTimes(2); // the third was never attempted
    expect(stopped.discard).toHaveBeenCalledTimes(3); // but every claimed file is released

    const ambiguous = make('live', [{ ok: false, ambiguous: true, why: 'timeout' }]);
    expect(await ambiguous.service.send({ chatId: 'known', uploadIds: ['f1', 'f2'] })).toEqual({ state: 'unknown', sent: 0, total: 2 });

    // Dry-run claims and releases them without dispatching.
    const dry = make('dry-run');
    expect(await dry.service.send({ chatId: 'known', uploadIds: ['f1', 'f2'] })).toEqual({ state: 'dry_run', sent: 0, total: 2 });
    expect(dry.send).not.toHaveBeenCalled();
    expect(dry.discard).toHaveBeenCalledTimes(2);

    // An unknown id refuses the whole batch, releasing whatever was already claimed.
    const unknown = make('live');
    await expect(unknown.service.send({ chatId: 'known', uploadIds: ['f1', 'missing'] })).rejects.toMatchObject({ code: 'UPLOAD_UNKNOWN', status: 409 });
    expect(unknown.send).not.toHaveBeenCalled();
    expect(unknown.discard).toHaveBeenCalledTimes(1);

    const tooMany = make('live');
    await expect(tooMany.service.send({ chatId: 'known', uploadIds: Array.from({ length: FILES_MAX + 1 }, (_, i) => `f${i}`) })).rejects.toMatchObject({ code: 'SEND_TOO_MANY_FILES' });
  });
  it('refuses an attachment when no upload store is configured', async () => {
    const { service } = setup('live');
    await expect(service.send({ chatId: 'known', text: 'hi', uploadIds: ['up'] })).rejects.toMatchObject({ code: 'SEND_ATTACHMENT_UNSUPPORTED', status: 400 });
  });
  it('never runs two live sends at once', async () => {
    let active = 0, maxActive = 0;
    const send = vi.fn(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 10)); active--; return { ok: true, raw: {} } as SendReply; });
    const service = new SendService({ mode: 'live', resolveChatGuid: () => 'g', clientFactory: () => ({ send } as unknown as SendClient) });
    await Promise.all([service.send(base), service.send(base), service.send(base)]);
    expect(maxActive).toBe(1);
  });
});
