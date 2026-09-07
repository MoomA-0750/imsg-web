import { describe, expect, it } from 'vitest';
import { capabilities, parseStatus } from '../src/server/capabilities.js';

// Whitelist-constructed real-derived STRUCTURE, only synthetic values; not a DB export.
function rpc(version = '0.15.1') {
  return {
    version, protocol_version: 1, database: { ready: true }, bridge: { ready: false },
    contacts: { available: true },
    methods: ['status', 'chats.list', 'messages.history', 'watch.subscribe', 'watch.unsubscribe', 'send', 'read', 'typing'],
    private_field: 'SECRET_SENTINEL',
  };
}
const m1 = { version: '0.15.1', sip: 'enabled', read_receipts: false, typing_indicators: false };
const intel = { version: '0.14.2', sip: 'disabled', read_receipts: true, typing_indicators: true };
describe('P0a A03 fixed capability truth table', () => {
  it('preserves DB reads without a bridge, but rejects SIP-gated read/typing despite method advertisement', () => {
    const c = capabilities(rpc(), m1);
    expect(c.chats).toEqual({ state: 'available', reasonCode: 'SUPPORTED' });
    expect(c.history).toEqual(c.chats); expect(c.watch).toEqual(c.chats);
    expect(c.read).toEqual({ state: 'unavailable', reasonCode: 'SIP_ENABLED' });
    expect(c.typing).toEqual(c.read);
    expect(c.send).toEqual({ state: 'unknown', reasonCode: 'NOT_IMPLEMENTED' });
  });
  it('does not require contacts for basic reads; never calls advertised mutations', () => {
    const r = rpc('0.14.2'); r.contacts.available = false; r.bridge.ready = true;
    const c = capabilities(r, intel);
    expect(c.contacts).toEqual({ state: 'unavailable', reasonCode: 'CONTACTS_UNAVAILABLE' });
    expect(c.chats.state).toBe('available');
    expect(c.read).toEqual({ state: 'available', reasonCode: 'SUPPORTED' });
    expect(c.typing).toEqual(c.read);
    expect(c.send.state).toBe('unknown');
  });
  it('does not turn independent reads off if CLI status fails', () => {
    const c = capabilities(rpc(), undefined);
    expect(c.chats.state).toBe('available'); expect(c.contacts.state).toBe('available');
    expect(c.read).toEqual({ state: 'unknown', reasonCode: 'CLI_STATUS_INVALID' });
  });
  it('distinguishes DB denial, method absence, and unknown versions', () => {
    const r = rpc(); r.database.ready = false;
    expect(capabilities(r, m1).history).toEqual({ state: 'unavailable', reasonCode: 'DATABASE_UNAVAILABLE' });
    r.database.ready = true; r.methods = ['chats.list'];
    expect(capabilities(r, m1).history).toEqual({ state: 'unavailable', reasonCode: 'METHOD_UNAVAILABLE' });
    expect(capabilities(rpc('1.2.3'), m1).chats).toEqual({ state: 'unknown', reasonCode: 'VERSION_UNTESTED' });
  });
  it.each([null, [], {}, { ...rpc(), database: { ready: 'true' } }, { ...rpc(), version: 'private@example.test' }])('fails closed on malformed status %#', input => {
    expect(capabilities(input, m1).chats).toEqual({ state: 'unknown', reasonCode: 'RPC_STATUS_INVALID' });
  });
  it('fails closed for unknown protocol and CLI version mismatch', () => {
    expect(capabilities({ ...rpc(), protocol_version: 2 }, m1).chats.reasonCode).toBe('VERSION_UNTESTED');
    expect(capabilities(rpc(), intel).read.reasonCode).toBe('CLI_STATUS_INVALID');
  });
  it('never copies unexpected private status fields into normalized output', () => {
    expect(JSON.stringify(parseStatus(rpc()))).not.toContain('SECRET_SENTINEL');
    expect(JSON.stringify(capabilities(rpc(), m1))).not.toContain('SECRET_SENTINEL');
  });
  it('requires unsubscribe and the individual CLI flag, not a global advanced flag', () => {
    const r = rpc('0.14.2'); r.methods = r.methods.filter(x => x !== 'watch.unsubscribe');
    expect(capabilities(r, intel).watch.reasonCode).toBe('METHOD_UNAVAILABLE');
    expect(capabilities(r, { ...intel, read_receipts: false, advanced_features: true }).read.reasonCode).toBe('FEATURE_UNAVAILABLE');
  });
});
