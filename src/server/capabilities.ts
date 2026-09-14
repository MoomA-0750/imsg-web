import { isObject } from './rpc/errors.js';

/**
 * Versions of `imsg` this project has actually exercised. Widening this list is
 * an assertion about testing, not a convenience: an untested version reports
 * every read capability as `unknown`, and that is the behaviour protecting a
 * user from a version whose reads have never been checked.
 *
 * `0.15.4` (with imsg-patches applied) was exercised against real data on the
 * M1 Mac; see docs/real-data-findings.md. Use through this application on the
 * production Mac is the owner's trial, not yet recorded.
 */
export const TESTED_VERSIONS = ['0.14.2', '0.15.1', '0.15.4'] as const;
export type Reason = 'SUPPORTED' | 'RPC_STATUS_INVALID' | 'VERSION_UNTESTED'
  | 'DATABASE_UNAVAILABLE' | 'METHOD_UNAVAILABLE' | 'CONTACTS_UNAVAILABLE'
  | 'CLI_STATUS_INVALID' | 'STATUS_PROBE_DISABLED' | 'SIP_ENABLED' | 'FEATURE_UNAVAILABLE' | 'NOT_IMPLEMENTED'
  | 'SEND_DISABLED' | 'SEND_DRY_RUN' | 'SEND_READY';
export type Capability = { state: 'available' | 'unavailable' | 'unknown'; reasonCode: Reason };
export type Status = {
  version: string; protocolVersion: number; databaseReady: boolean;
  bridgeReady: boolean; contactsAvailable: boolean; methods: string[];
};

export function parseStatus(input: unknown): Status | undefined {
  if (!isObject(input) || typeof input.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.version)
    || !Number.isSafeInteger(input.protocol_version)
    || !isObject(input.database) || typeof input.database.ready !== 'boolean'
    || !isObject(input.bridge) || typeof input.bridge.ready !== 'boolean'
    || !isObject(input.contacts) || typeof input.contacts.available !== 'boolean'
    || !Array.isArray(input.methods) || !input.methods.every(x => typeof x === 'string') || input.methods.length > 256) return;
  return {
    version: input.version, protocolVersion: input.protocol_version as number,
    databaseReady: input.database.ready, bridgeReady: input.bridge.ready,
    contactsAvailable: input.contacts.available, methods: input.methods as string[],
  };
}

const cap = (state: Capability['state'], reasonCode: Reason): Capability => ({ state, reasonCode });
/** Send is not derived from the read RPC status; it reflects how the server is configured to send. */
export function sendCapability(mode: 'off' | 'dry-run' | 'live'): Capability {
  return mode === 'off' ? cap('unavailable', 'SEND_DISABLED') : cap('available', mode === 'dry-run' ? 'SEND_DRY_RUN' : 'SEND_READY');
}
export function capabilities(rpc: unknown, cli?: unknown): Record<'chats' | 'history' | 'watch' | 'contacts' | 'read' | 'typing' | 'send', Capability> {
  const status = parseStatus(rpc);
  const invalid = status === undefined ? 'RPC_STATUS_INVALID'
    : status.protocolVersion !== 1 || !(TESTED_VERSIONS as readonly string[]).includes(status.version) ? 'VERSION_UNTESTED' : undefined;
  const read = (method: string): Capability => invalid ? cap('unknown', invalid)
    : !status!.databaseReady ? cap('unavailable', 'DATABASE_UNAVAILABLE')
    : !status!.methods.includes(method) ? cap('unavailable', 'METHOD_UNAVAILABLE')
    : cap('available', 'SUPPORTED');
  const advanced = (method: 'read' | 'typing', flag: string): Capability => {
    if (invalid) return cap('unknown', invalid);
    if (cli === undefined) return cap('unknown', 'STATUS_PROBE_DISABLED');
    if (!isObject(cli) || cli.version !== status!.version) return cap('unknown', 'CLI_STATUS_INVALID');
    if (cli.sip === 'enabled') return cap('unavailable', 'SIP_ENABLED');
    if (cli[flag] === false) return cap('unavailable', 'FEATURE_UNAVAILABLE');
    if (cli.sip !== 'disabled' || cli[flag] !== true) return cap('unknown', 'CLI_STATUS_INVALID');
    return status!.methods.includes(method) ? cap('available', 'SUPPORTED') : cap('unavailable', 'METHOD_UNAVAILABLE');
  };
  return {
    chats: read('chats.list'), history: read('messages.history'),
    watch: read('watch.subscribe').state === 'available' ? read('watch.unsubscribe') : read('watch.subscribe'),
    contacts: invalid ? cap('unknown', invalid) : status!.contactsAvailable ? cap('available', 'SUPPORTED') : cap('unavailable', 'CONTACTS_UNAVAILABLE'),
    read: advanced('read', 'read_receipts'), typing: advanced('typing', 'typing_indicators'),
    send: cap('unknown', 'NOT_IMPLEMENTED'),
  };
}
