import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { SendClient } from '../src/server/rpc/send-client.js';
import { testContext } from './helpers/child-context.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-send-imsg.mjs', import.meta.url));
function client(timeoutMs = 5000) {
  return new SendClient({ executable: process.execPath, context: testContext(), args: [FIXTURE], timeoutMs });
}
const send = (text: string, timeoutMs?: number) => client(timeoutMs).send({ chat_guid: 'g', text, transport: 'applescript', service: 'auto' });

describe('SendClient (synthetic imsg, plain send over applescript)', () => {
  it('reports a clean acknowledgement as ok, ignoring notices', async () => {
    expect(await send('OKSEND NOTICE')).toEqual({ ok: true, raw: { ok: true, transport: 'applescript' } });
  });
  it('passes through the error code, message and data so the service can classify it', async () => {
    expect(await send('NOTSTARTED')).toEqual({ ok: false, ambiguous: false, code: -32603, message: 'Delivery failed before dispatch', data: { transport: 'applescript', retry_safe: true, disposition: 'not_started', operation: 'send' } });
    expect(await send('BADPARAM')).toMatchObject({ ok: false, ambiguous: false, code: -32602, data: 'bad recipient' });
  });
  it('treats a timeout as ambiguous, never as a clean failure', async () => {
    expect(await send('HANG', 200)).toEqual({ ok: false, ambiguous: true });
  });
  it('treats the child closing without a reply as ambiguous', async () => {
    expect(await send('EXIT')).toEqual({ ok: false, ambiguous: true });
  });
  it('refuses a relative executable', () => {
    expect(() => new SendClient({ executable: 'imsg', context: testContext() })).toThrow();
  });
});
