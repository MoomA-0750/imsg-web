import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { SendClient } from '../src/server/rpc/send-client.js';
import { testContext } from './helpers/child-context.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-send-imsg.mjs', import.meta.url));
function client(timeoutMs = 5000) {
  return new SendClient({ executable: process.execPath, context: testContext(), args: [FIXTURE], timeoutMs });
}
const send = (text: string, timeoutMs?: number) => client(timeoutMs).send({ chat_guid: 'g', text, transport: 'applescript', service: 'auto', attempt_id: '00000000-0000-4000-8000-000000000000' });

describe('SendClient (synthetic imsg on the send path)', () => {
  it('reports a clean acknowledgement as ok, ignoring notices', async () => {
    expect(await send('OKSEND NOTICE')).toEqual({ ok: true, raw: { ok: true, transport: 'applescript', attempt_id: '00000000-0000-4000-8000-000000000000' } });
  });
  it('reports a definite RPC error as a non-ambiguous failure with its code and message', async () => {
    expect(await send('ERR')).toEqual({ ok: false, ambiguous: false, code: -32000, message: 'synthetic send failure' });
  });
  it('surfaces a reused attempt_id error so the caller can treat it as already sent', async () => {
    expect(await send('DUP')).toMatchObject({ ok: false, ambiguous: false, code: -32602 });
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
