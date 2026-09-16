import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatView } from '../../src/shared/web-types';

/** How many conversations may raise a notification in one refresh. A quiet hour back is not news. */
const MAX_NOTIFY = 5;
const BODY_MAX = 140;
const STORAGE_KEY = 'imsg_notify';

/** unsupported: this browser has no notifications, or the page is not in a secure context. */
export type NotifyStatus = 'unsupported' | 'denied' | 'off' | 'on';

function readStored(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function writeStored(on: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode: run without remembering */ }
}
const supported = (): boolean => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
function time(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** What a notification says under the conversation's name: the line the list already shows. */
export function notifyBody(chat: ChatView): string {
  const text = (chat.preview?.text ?? '').replace(/\s+/g, ' ').trim();
  const base = text === '' ? '新しいメッセージ' : text;
  return base.length > BODY_MAX ? `${base.slice(0, BODY_MAX - 1)}…` : base;
}

/**
 * Notifications for new incoming messages, and nothing else.
 *
 * Entirely local: the conversation's name and the line the list already shows are drawn by this
 * browser on the owner's own screen. Nothing is registered with a push service, nothing is sent
 * anywhere, and the server is not told any of it happened — so this adds no route, no egress and
 * no state that outlives the tab beyond a single remembered yes.
 *
 * Off until asked for, and asking is what requests permission: a page that demands the permission
 * on sight is a page people deny for ever.
 */
export function useNotifier(onOpen: (chat: ChatView) => void) {
  const [status, setStatus] = useState<NotifyStatus>(() => {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return Notification.permission === 'granted' && readStored() ? 'on' : 'off';
  });
  /** Read by the poll, which must not be rebuilt every time this changes. */
  const on = useRef(status === 'on');
  /** The newest message of each conversation as it stood last time; empty until the first look. */
  const seen = useRef(new Map<string, number>());
  const primed = useRef(false);
  const open = useRef<(chat: ChatView) => void>(onOpen);
  useEffect(() => { open.current = onOpen; }, [onOpen]);

  /** What is already there is not news: the first look after turning on only records where things stand. */
  const prime = useCallback((chats: ChatView[]) => {
    seen.current = new Map(chats.map(chat => [chat.id, time(chat.lastMessageAt) ?? 0]));
    primed.current = true;
  }, []);
  const forget = useCallback(() => { seen.current.clear(); primed.current = false; }, []);

  const enable = useCallback((chats: ChatView[]) => {
    on.current = true; prime(chats); writeStored(true); setStatus('on');
  }, [prime]);
  const disable = useCallback(() => {
    on.current = false; forget(); writeStored(false); setStatus('off');
  }, [forget]);

  const toggle = useCallback((chats: ChatView[]) => {
    if (!supported()) return;
    if (on.current) { disable(); return; }
    if (Notification.permission === 'granted') { enable(chats); return; }
    Promise.resolve(Notification.requestPermission())
      .then(answer => { if (answer === 'granted') enable(chats); else setStatus(answer === 'denied' ? 'denied' : 'off'); })
      .catch(() => {});
  }, [disable, enable]);

  const show = useCallback((chat: ChatView) => {
    try {
      // Tagged by conversation, so a talkative one replaces its own notice instead of stacking up.
      const notice = new Notification(chat.name || 'メッセージ', { body: notifyBody(chat), tag: `imsg:${chat.id}`, lang: 'ja' });
      notice.onclick = () => { try { window.focus(); } catch { /* the browser may refuse */ } open.current(chat); notice.close(); };
    } catch { /* the browser may refuse to show it; the list still updates */ }
  }, []);

  /**
   * Called with every fresh conversation list. A conversation is news when its newest message is
   * newer than the one last seen there — except one the owner sent from another device, which moves
   * the conversation on just the same, and except the one being read right now.
   */
  const sync = useCallback((chats: ChatView[], reading: string | null) => {
    if (!on.current) return;
    if (!primed.current) { prime(chats); return; }
    const fresh: ChatView[] = [];
    for (const chat of chats) {
      const at = time(chat.lastMessageAt);
      if (at === null) continue;
      const before = seen.current.get(chat.id);
      seen.current.set(chat.id, at);
      if (before !== undefined && at <= before) continue;
      if (chat.preview?.fromMe === true) continue;
      if (chat.id === reading && !document.hidden) continue; // it is on the screen already
      fresh.push(chat);
    }
    fresh.sort((a, b) => (time(b.lastMessageAt) ?? 0) - (time(a.lastMessageAt) ?? 0));
    for (const chat of fresh.slice(0, MAX_NOTIFY)) show(chat);
  }, [prime, show]);

  return { status, watching: on, toggle, sync, forget };
}
