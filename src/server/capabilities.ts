import { isObject } from './rpc/errors.js';

/**
 * Versions of `imsg` this project has actually exercised. Widening this list is
 * an assertion about testing, not a convenience: an untested version reports
 * every read capability as `unknown`, and that is the behaviour protecting a
 * user from a version whose reads have never been checked.
 *
 * `0.15.4` added 2026-09-14, on the owner's decision, against this evidence:
 *   - real-data parity baseline vs candidate EQUAL over 25 chats and 125
 *     messages, both arms reproducible on a static database
 *     (docs/step3-i-parity-result.md);
 *   - contact resolution confirmed including phone-number normalisation, in
 *     both the SSH and LaunchAgent contexts (step3-h1, step3-h2);
 *   - a read-only open of the real chat.db that modified nothing, not even an
 *     mtime (docs/step3-h3-result.md);
 *   - RPC-level timing across both arms (docs/step3-j1-timing-result.md).
 *
 * What that evidence does NOT yet include is C06 itself — the authenticated API
 * cycle through this application, p95 and RSS over the defined window. C06 was
 * blocked by this very list, so the list is being widened before the result
 * that would most directly justify it. That ordering is deliberate and
 * recorded; when C06 completes, its outcome belongs here.
 */
export const TESTED_VERSIONS = ['0.14.2', '0.15.1', '0.15.4'] as const;
export type Reason = 'SUPPORTED' | 'RPC_STATUS_INVALID' | 'VERSION_UNTESTED'
  | 'DATABASE_UNAVAILABLE' | 'METHOD_UNAVAILABLE' | 'CONTACTS_UNAVAILABLE'
  | 'CLI_STATUS_INVALID' | 'STATUS_PROBE_DISABLED' | 'SIP_ENABLED' | 'FEATURE_UNAVAILABLE' | 'NOT_IMPLEMENTED';
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
