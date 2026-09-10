// Transport-free preparation only: no sockets, processes, credentials or live CLI.
// The caller owns authenticated bounded GET transport and verified cleanup.
const check = value => { if (!value) throw new Error(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const nullableString = value => value === null || typeof value === 'string';
const round = value => Math.round(value * 10) / 10;

/** One fresh instance per application session; never reuse its opaque target across arms.
 * get(path) returns {status,data}; it must enforce response size/deadlines and not log.
 * No returned record contains response data, target, epoch, or arbitrary error text.
 */
export function createApiWorkload(get, now = () => performance.now()) {
  let epoch, target, active = false, stopped = false;
  return async function cycle() {
    if (active || stopped) return { outcome: 'unavailable', gateMeasurement: false };
    active = true;
    const times = {};
    let phase = 'capabilities';
    try {
      const began = now();
      const read = async (path, stage) => {
        const start = now(), response = await get(path), end = now();
        check(Number.isFinite(start) && Number.isFinite(end) && end >= start);
        times[stage] = round(end - start);
        check(response?.status === 200 && object(response.data));
        return response.data;
      };
      const caps = await read('/api/capabilities', 'capabilitiesMs');
      check(token(caps.epoch) && caps.mode === 'readonly' && object(caps.features));
      check(['chats', 'history'].every(k => caps.features[k]?.state === 'available'));
      check(['read', 'typing'].every(k => caps.features[k]?.state === 'unknown' && caps.features[k]?.reasonCode === 'STATUS_PROBE_DISABLED'));
      epoch ??= caps.epoch;
      check(epoch === caps.epoch);
      phase = 'chats';
      const chats = await read('/api/chats?limit=50', 'chatsMs');
      check(chats.epoch === epoch && chats.limit === 50 && Array.isArray(chats.chats) && chats.chats.length > 0 && chats.chats.length <= 50);
      check(chats.chats.every(c => object(c) && token(c.id) && typeof c.name === 'string' && c.name.length <= 512 && ['iMessage', 'SMS', 'Other'].includes(c.service) && (c.isGroup === null || typeof c.isGroup === 'boolean') && (c.unreadCount === null || (Number.isSafeInteger(c.unreadCount) && c.unreadCount >= 0)) && nullableString(c.lastMessageAt) && typeof c.trimmed === 'boolean'));
      check(new Set(chats.chats.map(c => c.id)).size === chats.chats.length);
      // Keep original API probe's first-chat selection, not history experiment's filter.
      target ??= chats.chats[0].id;
      check(chats.chats.some(c => c.id === target));
      phase = 'history';
      const history = await read(`/api/chats/${target}/messages?limit=50`, 'historyMs');
      check(history.epoch === epoch && history.limit === 50 && Array.isArray(history.messages) && history.messages.length <= 50);
      check(history.messages.every(m => object(m) && token(m.id) && typeof m.text === 'string' && m.text.length <= 16384 && typeof m.isFromMe === 'boolean' && nullableString(m.createdAt) && typeof m.trimmed === 'boolean'));
      check(new Set(history.messages.map(m => m.id)).size === history.messages.length);
      const elapsed = now() - began;
      check(Number.isFinite(elapsed) && elapsed >= 0);
      return { outcome: 'ok', gateMeasurement: false, ...times, cycleMs: round(elapsed), chats: chats.chats.length, messages: history.messages.length, nonemptyHistory: history.messages.length > 0 };
    } catch {
      stopped = true;
      return { outcome: 'failed', phase, gateMeasurement: false };
    } finally { active = false; }
  };
}
