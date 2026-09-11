// Fixed numeric sample contract; never return caller-supplied objects/spreads.
export function validateSample(value) {
  const keys = ['capabilitiesMs', 'chatsMs', 'historyMs', 'cycleMs', 'chats', 'messages', 'nonemptyHistory'];
  const fail = () => { throw new Error('SAMPLE_REJECTED'); };
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
  for (const key of keys.slice(0, 4)) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 60000 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-7) fail();
  }
  if (!Number.isInteger(value.chats) || value.chats < 1 || value.chats > 50
    || !Number.isInteger(value.messages) || value.messages < 0 || value.messages > 50
    || value.nonemptyHistory !== (value.messages > 0)
    || Math.max(value.capabilitiesMs, value.chatsMs, value.historyMs) > value.cycleMs
    || value.capabilitiesMs + value.chatsMs + value.historyMs > value.cycleMs + 0.2) fail();
  return { capabilitiesMs: value.capabilitiesMs, chatsMs: value.chatsMs, historyMs: value.historyMs,
    cycleMs: value.cycleMs, chats: value.chats, messages: value.messages, nonemptyHistory: value.nonemptyHistory };
}
