import { FormEvent, PointerEvent, ReactNode, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Add24Regular, ArrowLeft24Regular, Checkmark24Regular, Copy24Regular, Dismiss12Regular, Send24Filled } from '@fluentui/react-icons';
import type { AttachmentView, CapabilitySnapshot, ChatSnapshot, ChatView, HistorySnapshot, LinkView, MessageView, ReactionView, ReplyView } from '../../src/shared/web-types';

const PAGE = 50;
const MAX = 1000;
const POLL_MS = 15_000;
/** Scrolling this close to the end of a list asks for the next page. */
const NEAR_EDGE = 240;
/** Within this of the bottom of a conversation counts as watching for the newest message. */
const NEAR_BOTTOM = 48;
/** How far the conversation slides aside to show the times. */
const REVEAL_MAX = 72;
/** Pulling an opened picture this far down puts it away. */
const PULL_CLOSE = 90;
/** A pause this long earns a line of its own, the way Messages breaks up a quiet afternoon. */
const BREAK_GAP_MS = 3_600_000;
/** The quiet line at the end of a list: what is loading, or why nothing more is coming. */
const LIST_NOTE = 'list-note m-0 px-4 py-3 text-center text-muted text-xs';
const CENTRED = 'min-h-screen grid place-items-center p-5';
const FIELD = 'w-full rounded-[10px] border border-field p-[.8rem] bg-surface text-inherit';
/** Below `pane:` the two panes stack, one sliding over the other; from there on they sit side by side. */
const HEADING = 'flex items-center gap-3 min-h-[64px] px-4 py-[.85rem] border-b border-line';
const PANE_TITLE = 'my-1 text-[1.25rem] leading-tight [overflow-wrap:anywhere]';
const TRIM = 'text-muted text-[.75em]';
const STAMP = 'shrink-0 text-muted text-[.72rem]';
const PANE = 'flex flex-col min-w-0 min-h-0 overflow-hidden absolute inset-0 transition-transform duration-200 motion-reduce:transition-none pane:static pane:visible pane:translate-x-0';

type Session = { csrfToken: string; mode: 'readonly' };
type ApiError = Error & { status?: number };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { Accept: 'application/json', ...init?.headers } });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'セッションが無効です' : `更新に失敗しました (${response.status})`) as ApiError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

const TIME = new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('ja-JP', { weekday: 'long' });
const DAY = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short' });
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** A day the owner can place without doing arithmetic: 今日, 昨日, the weekday, then the date. */
function dayLabel(date: Date, now = new Date()): string {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  return days > 1 && days < 7 ? WEEKDAY.format(date) : DAY.format(date);
}
const readDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
};

function dateLabel(value: string | null): string {
  if (!value) return '日時不明';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

const ATTACHMENT_LABEL = { image: '画像', video: '動画', file: '添付ファイル' } as const;
/** One bubble's worth of a message: a picture, the words, or a link's card. */
type Part = { key: string; media: AttachmentView } | { key: string; text: true } | { key: string; link: LinkView; host: string };
const SHELL = 'bubble border border-line shadow-[0_2px_8px_#0f1f3a0f] overflow-hidden';
const PAD = 'px-[.85rem] py-[.7rem]';
/**
 * The corner nearest the speaker is square: it is the tail, and it is also what joins one bubble to
 * the next, whether that is the same person talking again or the same message continuing in a
 * second bubble. Half a line's height on the others, so a one-line bubble comes out a pill.
 */
const corners = (fromMe: boolean, joined: boolean) => fromMe
  ? (joined ? 'rounded-[24px_4px_4px_24px]' : 'rounded-[24px_24px_4px_24px]')
  : (joined ? 'rounded-[4px_24px_24px_4px]' : 'rounded-[24px_24px_24px_4px]');
/** Only an absolute http(s) link is worth a card; anything else is left as the text it came in. */
function webHost(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname : null; }
  catch { return null; }
}

/**
 * A picture gets a bubble of its own with no padding, so it reaches the edges. What cannot be shown
 * falls back to a line of text, and that line wants its padding back.
 *
 * Opening one asks for the original: if it is on the Mac it fills the screen, and if only Messages'
 * thumbnail survives, the picture says so over itself and then stops saying it. Nothing is written
 * under a thumbnail otherwise — the two look alike, and a caption on every one of them is a label
 * the owner has to read past every time to learn nothing.
 */
function MediaBubble({ item, shape, tone, quote, tail, onOpen }: { item: AttachmentView; shape: string; tone: string; quote: ReactNode; tail: ReactNode; onOpen: (item: AttachmentView) => void }) {
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);
  if (item.id && !failed) {
    const image = <img className={`attachment-image block max-w-full h-auto ${item.sticker ? 'sticker max-h-32' : 'max-h-96'}`}
      src={`/api/attachments/${encodeURIComponent(item.id)}`}
      alt={item.preview ? '添付画像（元の画像はこのMacにありません）' : '添付画像'}
      loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
    return <div className={`${SHELL} ${shape} ${tone} p-0 w-fit`}>
      {quote && <div className={`${PAD} pb-0`}>{quote}</div>}
      <button type="button" className="attachment-open relative block p-0 border-0 bg-transparent"
        aria-label={item.preview ? '元の画像があるか確かめる' : '画像を大きく表示'}
        onClick={() => (item.preview ? setAsked(n => n + 1) : onOpen(item))}>
        {image}
        {asked > 0 && <span key={asked} className="missing-note absolute inset-0 grid place-items-center p-4 bg-black/60 text-white font-bold text-center text-[.9rem] [overflow-wrap:anywhere]"
          onAnimationEnd={() => setAsked(0)}>元の画像はこのMacにありません</span>}
      </button>
      {tail && <div className={`${PAD} pt-[.4rem]`}>{tail}</div>}
    </div>;
  }
  const reason = item.preview || !item.id ? (item.kind === 'image' ? 'このMacに保存されていないか、表示できない形式です' : 'この画面では表示できません') : 'このブラウザでは表示できない形式です';
  return <div className={`${SHELL} ${shape} ${tone} ${PAD}`}>
    {quote}
    <p className="attachment m-0 text-muted text-[.9em]">{ATTACHMENT_LABEL[item.kind]}（{reason}）</p>
    {tail}
  </div>;
}

/** The picture on its own, as large as the screen allows. Escape, the button, or the backdrop closes it. */
function Lightbox({ item, onClose }: { item: AttachmentView; onClose: () => void }) {
  const [pulled, setPulled] = useState(0);
  const from = useRef<number | undefined>(undefined);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  // Pulling the picture down puts it away, the gesture a picture opened full-screen invites. It
  // follows the finger so the intent is visible before it is committed to, and springs back short
  // of the distance that means it.
  const down = (event: PointerEvent<HTMLDivElement>) => { from.current = event.clientY; };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (from.current === undefined) return;
    setPulled(Math.max(0, event.clientY - from.current));
  };
  const up = () => { if (pulled > PULL_CLOSE) onClose(); else { setPulled(0); from.current = undefined; } };
  return <div className="lightbox fixed inset-0 z-50 flex items-center justify-center p-4 touch-none"
    style={{ backgroundColor: `rgb(0 0 0 / ${Math.max(0.35, 0.85 - pulled / 500)})` }}
    role="dialog" aria-modal="true" aria-label="画像"
    onClick={onClose} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {/* Sized against the window rather than the box around it: a grid or flex track measured from
        the picture cannot also constrain it, which let a tall one run off the screen. */}
    <img className="max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] object-contain"
      style={{ transform: `translateY(${pulled}px)`, opacity: Math.max(0, 1 - pulled / 400), transition: from.current === undefined ? 'transform .18s ease, opacity .18s ease' : 'none' }}
      src={`/api/attachments/${encodeURIComponent(item.id!)}`} alt="添付画像" draggable={false} onClick={event => event.stopPropagation()} />
    <button type="button" className="absolute top-4 right-4 grid place-items-center w-11 h-11 p-0 rounded-full border-0 bg-white/15 text-white" onClick={onClose} aria-label="閉じる" autoFocus><Dismiss12Regular /></button>
  </div>;
}

/** A link's card, likewise its own bubble: the preview image reaches the edges, the words do not. */
function LinkBubble({ link, host, shape, tone, quote, tail }: { link: LinkView; host: string; shape: string; tone: string; quote: ReactNode; tail: ReactNode }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageId = link.image?.id;
  return <div className={`${SHELL} ${shape} ${tone} p-0 max-w-[22rem]`}>
    {quote && <div className={`${PAD} pb-0`}>{quote}</div>}
    <a className="link-card flex flex-col text-inherit no-underline" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {imageId && !imageFailed && <img className="block w-full max-h-48 object-cover" src={`/api/attachments/${encodeURIComponent(imageId)}`} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setImageFailed(true)} />}
      <span className="link-body flex flex-col gap-[.15rem] px-[.85rem] py-[.6rem] min-w-0 [overflow-wrap:anywhere]"><strong className="leading-[1.35]">{link.title || host}</strong>{link.summary && <span className="text-muted text-[.85em] line-clamp-3">{link.summary}</span>}<span className="text-muted text-[.78em]">{link.siteName && link.siteName !== host ? `${link.siteName} · ${host}` : host}</span></span>
    </a>
    {tail && <div className={`${PAD} pt-0`}>{tail}</div>}
  </div>;
}

function ReplyQuote({ reply }: { reply: ReplyView }) {
  return <p className="reply-quote block m-0 mb-[.35rem] last:mb-0 px-2 py-[.3rem] border-l-[3px] border-line bg-soft rounded-r-lg text-muted text-[.85em] whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="block font-semibold text-[.92em]">{reply.sender ?? '自分'}</span>{reply.text}{reply.trimmed && <span className="text-muted text-[.75em]">（省略）</span>}</p>;
}

function Reactions({ list }: { list: ReactionView[] }) {
  return <ul className="reactions flex flex-wrap gap-[.3rem] list-none mt-[.1rem] mb-[.3rem] last:mb-0 p-0">{list.map(reaction => {
    const who = [...reaction.senders, ...(reaction.fromMe ? ['自分'] : [])];
    return <li key={`${reaction.kind}:${reaction.emoji}`} className="inline-flex items-center gap-[.15rem] px-[.4rem] py-[.1rem] border border-line rounded-full bg-surface text-[.85em]" title={who.length > 0 ? who.join('、') : reaction.kind}>
      <span aria-hidden="true">{reaction.emoji || '•'}</span>
      {reaction.count > 1 && <span className="text-muted text-[.85em]">{reaction.count}</span>}
      <span className="sr-only">{`${who.length > 0 ? `${who.join('、')}の` : ''}リアクション${reaction.count > 1 ? ` ${reaction.count}件` : ''}`}</span>
    </li>;
  })}</ul>;
}

type SendResult = { state: 'sent' | 'failed' | 'unknown' | 'dry_run'; sent?: number; total?: number };
type SendMode = 'live' | 'dry-run';

const MiB = 1024 * 1024;
const sizeLabel = (bytes: number) => bytes >= MiB ? `${(bytes / MiB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const FILES_MAX = 10;
const NOTICE_COLOUR = { ok: 'text-accent-strong', warn: 'text-warn', error: 'text-danger' } as const;
/** The composer's two circular buttons, sized to sit level with the field beside them. */
const ROUND = 'shrink-0 grid place-items-center w-11 h-11 p-0 rounded-full';

/**
 * A chosen file as a rounded square, with the file name only as its tooltip and alternative text —
 * the picture is the identification. The object URL is revoked when the choice changes.
 */
function Thumbnail({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const created = URL.createObjectURL(file);
    setUrl(created); setFailed(false);
    return () => { URL.revokeObjectURL(created); setUrl(null); };
  }, [file]);
  const shape = 'composer-thumb block w-16 h-16 rounded-xl border border-line object-cover bg-soft';
  const label = `${file.name}（${sizeLabel(file.size)}）`;
  return <div className="relative shrink-0" title={label}>
    {/* Nothing is uploaded to draw this; a format the browser cannot decode (HEIC) falls back to a word. */}
    {url && !failed
      ? <img className={shape} src={url} alt={label} onError={() => setFailed(true)} />
      : <span className={`${shape} placeholder flex items-center justify-center text-center text-[.65rem] text-muted`}>{file.type.startsWith('image/') ? '画像' : 'ファイル'}</span>}
    <button type="button" aria-label={`${file.name} を外す`} disabled={disabled}
      className="absolute -top-1.5 -right-1.5 grid place-items-center w-5 h-5 rounded-full border border-line bg-surface text-muted enabled:hover:text-ink"
      onClick={onRemove}><Dismiss12Regular /></button>
  </div>;
}

function Composer({ chat, mode, send, upload, onSent, onAuthError }: { chat: ChatView; mode: SendMode; send: (chatId: string, text: string, uploadIds: string[]) => Promise<SendResult>; upload: (file: File) => Promise<{ uploadId: string }>; onSent: () => void; onAuthError: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // Grows to fit what is being written, so there is nothing to drag. Measured from zero, because a
  // textarea's scrollHeight never shrinks below the height it is already given.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const clearFiles = () => { setFiles([]); if (picker.current) picker.current.value = ''; };
  /** Picking again adds to the selection instead of replacing it; the same file twice is ignored. */
  const addFiles = (chosen: File[]) => {
    const merged = [...files];
    let overflow = false;
    for (const file of chosen) {
      if (merged.some(have => have.name === file.name && have.size === file.size && have.lastModified === file.lastModified)) continue;
      if (merged.length >= FILES_MAX) { overflow = true; continue; }
      merged.push(file);
    }
    setFiles(merged);
    setNotice(overflow ? { kind: 'warn', text: `添付は${FILES_MAX}件までです。超えた分は追加していません。` } : null);
  };
  useEffect(() => { setText(''); setFiles([]); setBusy(false); setNotice(null); }, [chat.id]);

  const dispatch = async () => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      // Every attachment is uploaded first; the send then refers to them by opaque ids.
      const ids: string[] = [];
      for (const file of files) ids.push((await upload(file)).uploadId);
      const result = await send(chat.id, text, ids);
      // Several attachments are several messages, so a batch can stop part way; say exactly how far it got.
      const done = result.sent ?? 0, total = result.total ?? 0;
      const progress = total > 1 ? `${total}件中${done}件を送信しました。` : '';
      if (result.state === 'sent') { setText(''); clearFiles(); setNotice({ kind: 'ok', text: total > 1 ? `${total}件すべて送信しました。` : '送信しました。' }); onSent(); }
      else if (result.state === 'dry_run') { setText(''); clearFiles(); setNotice({ kind: 'ok', text: 'テスト送信しました（実際には送られていません）。' }); }
      // Not sent (imsg reported it never started): what is left is kept for a safe edit-and-resend.
      else if (result.state === 'failed') { if (done > 0) onSent(); setNotice({ kind: 'error', text: `${progress}続きは送信できませんでした（送信されていません）。宛先や内容を確認してください。` }); }
      // May or may not have gone out: do not silently resend.
      else { if (done > 0) onSent(); setNotice({ kind: 'warn', text: `${progress}続きは送信できたか不明です。メッセージアプリで届いたか確認してください。もう一度送ると二重になることがあります。` }); }
    } catch (error) {
      const status = (error as ApiError).status;
      if (status === 401) { onAuthError(); return; }
      setNotice({ kind: 'error', text: status === 413 ? 'ファイルが大きすぎます。' : status === 429 ? '送信数の上限に達しました。しばらく待ってください。' : status === 409 ? '会話が更新されました。開き直してください。' : status === 400 ? '送信内容を確認してください（空、長すぎる、宛先が無効 など）。' : '送信できませんでした。' });
    } finally { setBusy(false); }
  };

  const ready = text.trim() !== '' || files.length > 0;
  // No confirmation step: the owner asked for sending to be immediate. Double submission is still
  // held off while one is in flight, and every outcome is reported honestly.
  const submit = () => { if (ready && !busy) void dispatch(); };
  return <form className="composer shrink-0 flex flex-col gap-2 px-4 py-[.7rem] border-t border-line bg-surface" onSubmit={event => { event.preventDefault(); submit(); }}>
    {mode === 'dry-run' && <p className="m-0 text-muted text-[.8rem]" role="status">テスト送信モードです。実際には送信されません。</p>}
    <input ref={picker} type="file" hidden multiple aria-label="添付ファイルを選ぶ" onChange={event => { const chosen = [...(event.target.files ?? [])]; event.target.value = ''; addFiles(chosen); }} />
    {files.length > 0 && <ul className="composer-files list-none m-0 p-0 flex flex-wrap gap-2">{files.map((file, index) =>
      <li key={`${file.name}:${index}`}><Thumbnail file={file} disabled={busy} onRemove={() => setFiles(rest => rest.filter((_, at) => at !== index))} /></li>)}</ul>}
    {notice && <p className={`m-0 text-[.85rem] ${NOTICE_COLOUR[notice.kind]}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    <div className="flex items-end gap-2">
      <button type="button" className={`${ROUND} border border-line bg-soft text-accent-strong enabled:hover:bg-accent-soft`} onClick={() => picker.current?.click()} disabled={busy} aria-label="添付ファイルを追加"><Add24Regular /></button>
      <textarea ref={field} className="grow min-w-0 resize-none h-11 min-h-11 max-h-48 overflow-y-auto rounded-[1.375rem] border border-field px-4 py-[.55rem] leading-6 bg-surface text-inherit"
        value={text} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }}
        placeholder={chat.service === 'iMessage' ? 'iMessage' : 'SMS'} rows={1} maxLength={8000} aria-label="メッセージを入力" disabled={busy} />
      <button type="submit" className={`${ROUND} border-0 bg-accent text-white enabled:hover:bg-accent-strong`} disabled={busy || !ready} aria-label={busy ? '送信中' : '送信'}><Send24Filled /></button>
    </div>
  </form>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [chats, setChats] = useState<ChatView[]>([]);
  const [chatLimit, setChatLimit] = useState(PAGE);
  const [selected, setSelected] = useState<ChatView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [messageLimit, setMessageLimit] = useState(PAGE);
  /** The limits the rendered rows were actually fetched with. 0 until the first page lands. */
  const [loadedLimit, setLoadedLimit] = useState(0);
  const [loadedChatLimit, setLoadedChatLimit] = useState(0);
  const [chatsBusy, setChatsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [capability, setCapability] = useState<CapabilitySnapshot | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [epochNotice, setEpochNotice] = useState('');

  const generation = useRef(0);
  const epoch = useRef<string | null>(null);
  const selectedId = useRef<string | null>(null);
  const inFlight = useRef<Record<string, AbortController | undefined>>({});

  const viewport = useRef<HTMLDivElement | null>(null);
  /** How far the conversation is dragged aside, and where the drag that is doing it began. */
  const [reveal, setReveal] = useState(0);
  /** The picture being looked at on its own, if any. */
  const [viewing, setViewing] = useState<AttachmentView | null>(null);
  const from = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragging = useRef(false);
  const chatViewport = useRef<HTMLDivElement | null>(null);
  /** Following the newest message: keep the view at the bottom as messages arrive. True until the owner scrolls up. */
  const following = useRef(true);
  /** The scroll geometry as it was before the current render, so a page added above can be cancelled out. */
  const before = useRef({ height: 0, top: 0 });
  const shown = useRef<{ count: number; first: string | null }>({ count: 0, first: null });

  const abortAll = useCallback(() => {
    for (const controller of Object.values(inFlight.current)) controller?.abort();
    inFlight.current = {};
  }, []);

  const clearPrivate = useCallback(() => {
    generation.current += 1;
    abortAll();
    epoch.current = null;
    selectedId.current = null;
    setChats([]); setSelected(null); setMessages([]); setCapability(null);
    setChatError(''); setHistoryError(''); setCapabilityError(''); setEpochNotice('');
    setChatsBusy(false); setHistoryBusy(false);
    setChatLimit(PAGE); setMessageLimit(PAGE); setLoadedLimit(0); setLoadedChatLimit(0); setViewing(null);
    following.current = true;
  }, [abortAll]);

  const loseSession = useCallback(() => {
    clearPrivate();
    setSession(null);
    setKey('');
    setLoginError('セッションの有効期限が切れました。もう一度ログインしてください。');
  }, [clearPrivate]);

  const switchEpoch = useCallback((next: string, requestGeneration: number): boolean => {
    if (requestGeneration !== generation.current) return false;
    if (epoch.current === null) { epoch.current = next; return true; }
    if (epoch.current === next) return true;
    generation.current += 1;
    abortAll();
    epoch.current = next;
    selectedId.current = null;
    setChats([]); setSelected(null); setMessages([]); setCapability(null);
    setChatsBusy(false); setHistoryBusy(false);
    setChatError(''); setHistoryError(''); setCapabilityError('');
    setMessageLimit(PAGE); setLoadedLimit(0); setChatLimit(PAGE); setLoadedChatLimit(0); following.current = true;
    setEpochNotice('メッセージデータが更新されました。会話を選び直してください。');
    return false;
  }, [abortAll]);

  const run = useCallback(async <T,>(resource: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current[resource]) return undefined;
    const controller = new AbortController();
    inFlight.current[resource] = controller;
    try { return await task(controller.signal); }
    finally { if (inFlight.current[resource] === controller) delete inFlight.current[resource]; }
  }, []);

  const loadChats = useCallback(async () => {
    const started = generation.current, asked = chatLimit;
    setChatsBusy(true);
    try {
      await run('chats', async signal => {
        const data = await api<ChatSnapshot>(`/api/chats?limit=${asked}`, { signal });
        if (!switchEpoch(data.epoch, started) || started !== generation.current) return;
        setChats(data.chats.slice(0, MAX)); setLoadedChatLimit(asked); setChatError(''); setEpochNotice('');
        if (selectedId.current && !data.chats.some(chat => chat.id === selectedId.current)) {
          selectedId.current = null; setSelected(null); setMessages([]);
          setHistoryError('選択していた会話が一覧からなくなりました。');
        }
      });
    } catch (error) {
      if ((error as ApiError).status === 401 && started === generation.current) loseSession();
      else if ((error as Error).name !== 'AbortError' && started === generation.current) setChatError('更新できていません。表示中の一覧は前回取得時のものです。');
    } finally { if (started === generation.current) setChatsBusy(false); }
  }, [chatLimit, loseSession, run, switchEpoch]);

  const loadHistory = useCallback(async () => {
    const id = selectedId.current;
    if (!id) return;
    const started = generation.current, asked = messageLimit;
    setHistoryBusy(true);
    try {
      await run('history', async signal => {
        const data = await api<HistorySnapshot>(`/api/chats/${encodeURIComponent(id)}/messages?limit=${asked}`, { signal });
        if (selectedId.current !== id || !switchEpoch(data.epoch, started) || started !== generation.current) return;
        setMessages(data.messages.slice(0, MAX)); setLoadedLimit(asked); setHistoryError('');
      });
    } catch (error) {
      if ((error as ApiError).status === 401 && started === generation.current) loseSession();
      else if ((error as Error).name !== 'AbortError' && started === generation.current && selectedId.current === id) setHistoryError('更新できていません。表示中の本文は前回取得時のものです。');
    } finally { if (started === generation.current && selectedId.current === id) setHistoryBusy(false); }
  }, [loseSession, messageLimit, run, switchEpoch]);

  const loadCapabilities = useCallback(async () => {
    const started = generation.current;
    try {
      await run('capabilities', async signal => {
        const data = await api<CapabilitySnapshot>('/api/capabilities', { signal });
        if (!switchEpoch(data.epoch, started) || started !== generation.current) return;
        setCapability(data); setCapabilityError('');
      });
    } catch (error) {
      if ((error as ApiError).status === 401 && started === generation.current) loseSession();
      else if ((error as Error).name !== 'AbortError' && started === generation.current) setCapabilityError('機能状態を更新できません');
    }
  }, [loseSession, run, switchEpoch]);

  const sendMessage = useCallback(async (chatId: string, text: string, uploadIds: string[]): Promise<SendResult> => {
    const token = session?.csrfToken;
    if (!token) { const error = new Error('no session') as ApiError; error.status = 401; throw error; }
    const body: Record<string, unknown> = { chatId };
    if (text.trim() !== '') body.text = text;
    if (uploadIds.length > 0) body.uploadIds = uploadIds;
    return api<SendResult>('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
  }, [session]);

  const uploadFile = useCallback(async (file: File): Promise<{ uploadId: string }> => {
    const token = session?.csrfToken;
    if (!token) { const error = new Error('no session') as ApiError; error.status = 401; throw error; }
    // Raw bytes, streamed: no base64 inflation. octet-stream cannot come from an HTML form, so CSRF cover is unchanged.
    return api<{ uploadId: string }>(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': token }, body: file });
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    api<Session>('/api/session', { signal: controller.signal }).then(value => setSession(value)).catch(error => {
      if ((error as ApiError).status !== 401 && (error as Error).name !== 'AbortError') setLoginError('サーバーへ接続できません。');
    }).finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  useEffect(() => { if (session && selected) void loadHistory(); }, [session, selected, loadHistory]);

  useEffect(() => {
    if (!session) return;
    let timer: number | undefined;
    let stopped = false;
    let running = false;
    let refreshPending = false;
    const schedule = () => {
      if (!stopped && !document.hidden) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    const poll = async () => {
      if (stopped || document.hidden) return;
      if (running) { refreshPending = true; return; }
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      running = true;
      try { await Promise.all([loadChats(), loadCapabilities(), selectedId.current ? loadHistory() : Promise.resolve()]); }
      finally {
        running = false;
        if (stopped) return;
        if (refreshPending && !document.hidden) { refreshPending = false; void poll(); }
        else schedule();
      }
    };
    void poll();
    const resume = () => {
      if (document.hidden) {
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
        return;
      }
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      if (running) refreshPending = true;
      else void poll();
    };
    document.addEventListener('visibilitychange', resume); window.addEventListener('focus', resume);
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume); };
  }, [session, loadChats, loadCapabilities, loadHistory]);

  // A conversation opens at its newest message and stays there while following. When a page
  // is added above instead, the view keeps the message it was on: the list grew by exactly
  // the height difference, so putting that back under the same scroll offset holds it still.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const first = messages[0]?.id ?? null;
    const grewAbove = messages.length > shown.current.count && first !== shown.current.first;
    if (following.current) el.scrollTop = el.scrollHeight;
    else if (grewAbove) el.scrollTop = el.scrollHeight - before.current.height + before.current.top;
    shown.current = { count: messages.length, first };
    before.current = { height: el.scrollHeight, top: el.scrollTop };
  }, [messages]);

  // A list that does not fill its pane cannot be scrolled, and scrolling is the only way to ask
  // for the next page. Fetch it directly instead, until the pane is full or the list is complete.
  useLayoutEffect(() => {
    const el = chatViewport.current;
    if (el && el.scrollHeight <= el.clientHeight) loadMoreChats();
  }, [chats]);

  // Two things move the newest message off the bottom after it has been put there: an image
  // settling into the height it needs, and the area itself losing height to the composer
  // appearing or to a message being typed over several lines. While following, undo both.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const stick = () => { if (following.current) el.scrollTop = el.scrollHeight; };
    el.addEventListener('load', stick, true); // `load` does not bubble; capture reaches it
    const observer = new ResizeObserver(stick);
    observer.observe(el);
    return () => { el.removeEventListener('load', stick, true); observer.disconnect(); };
  }, [selected]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true); setLoginError('');
    try {
      const value = await api<Session>('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      setKey(''); clearPrivate(); setSession(value);
    } catch (error) {
      setLoginError((error as ApiError).status === 401 ? 'パスワードが正しくありません。' : (error as ApiError).status === 429 ? '試行回数が多すぎます。しばらく待ってください。' : 'ログインできませんでした。');
    } finally { setLoginBusy(false); }
  }

  function choose(chat: ChatView) {
    // Already here: clearing and reloading would only blank the conversation, and a second click
    // on the same row does not even change `selected`, so nothing would fetch it back.
    if (selectedId.current === chat.id) return;
    inFlight.current.history?.abort(); delete inFlight.current.history;
    selectedId.current = chat.id; setSelected(chat); setMessages([]); setHistoryError('');
    setMessageLimit(PAGE); setLoadedLimit(0); following.current = true;
    setReveal(0); from.current = undefined; dragging.current = false; setViewing(null);
  }

  // Asking for one more page. The in-flight read is for the old limit, so drop it:
  // the poll restarts on the limit change and would otherwise wait out a whole cycle.
  function loadOlder() {
    if (!hasOlder || olderPending) return;
    inFlight.current.history?.abort(); delete inFlight.current.history;
    setMessageLimit(value => Math.min(MAX, value + PAGE));
  }

  // Following ends only by scrolling up, never by the list growing. A thumbnail loading above
  // the view makes the browser shift the scroll to hold the content still, which fires a scroll
  // event from the bottom of the list: reading "not at the bottom" out of that would strand the
  // view a few pixels short of the newest message and leave it there.
  function onScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const scrolledUp = el.scrollTop < before.current.top;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
    following.current = atBottom || (following.current && !scrolledUp);
    before.current = { height: el.scrollHeight, top: el.scrollTop };
    if (el.scrollTop <= NEAR_EDGE) loadOlder();
  }

  // A larger page has been asked for but has not arrived. Getting back as many rows
  // as were asked for is the only evidence that there are more.
  const olderPending = messageLimit > loadedLimit;
  const hasOlder = loadedLimit > 0 && messages.length >= loadedLimit && messageLimit < MAX;
  const chatsPending = chatLimit > loadedChatLimit;
  const hasMoreChats = loadedChatLimit > 0 && chats.length >= loadedChatLimit && chatLimit < MAX;

  function loadMoreChats() {
    if (!hasMoreChats || chatsPending) return;
    inFlight.current.chats?.abort(); delete inFlight.current.chats;
    setChatLimit(value => Math.min(MAX, value + PAGE));
  }

  // Dragging the conversation to the left uncovers the times parked off its right edge, the way
  // Messages does it. Vertical movement is left alone: the browser scrolls, and this never starts.
  function onRevealDown(event: PointerEvent<HTMLOListElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    from.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;
  }
  function onRevealMove(event: PointerEvent<HTMLOListElement>) {
    const start = from.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!dragging.current) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) { if (Math.abs(dy) > 8) from.current = undefined; return; }
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setReveal(Math.max(0, Math.min(REVEAL_MAX, -dx)));
  }
  function endReveal() { from.current = undefined; dragging.current = false; setReveal(0); }

  function onChatScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_EDGE) loadMoreChats();
  }

  if (checking) return <main className={CENTRED}><p role="status">セッションを確認しています…</p></main>;
  if (!session) return <main className={CENTRED}><section className="login-card w-[min(100%,430px)] p-[1.35rem] pane:p-8 border border-line rounded-[18px] bg-surface shadow-[0_18px_45px_#13294a20]" aria-labelledby="login-title">
    {recovering ? <Recovery onBack={() => setRecovering(false)} /> : <>
    <div className="text-accent font-extrabold tracking-[.04em]">imsg Web</div>
    <h1 id="login-title" className="mt-3 mb-1 text-[1.75rem] leading-tight [overflow-wrap:anywhere]">メッセージを見る</h1>
    <form className="grid gap-3 mt-6" onSubmit={login}>
      <label className="font-bold" htmlFor="owner-key">パスワード</label>
      <input id="owner-key" className={FIELD} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required autoFocus />
      <button className="btn" disabled={loginBusy}>{loginBusy ? '確認中…' : 'ログイン'}</button>
      {loginError && <p className="m-0 mt-1 text-danger" role="alert">{loginError}</p>}
    </form>
    <button type="button" className="mt-4 p-0 bg-transparent border-0 text-accent-strong text-[.85rem] underline underline-offset-2 hover:text-accent" onClick={() => setRecovering(true)}>パスワードを忘れた場合</button>
    </>}
  </section></main>;

  // Blue only when the conversation is known to be iMessage; green covers SMS and anything else,
  // the way Messages colours it. imsg reports the service per conversation, not per message.
  const sentTone = selected?.service === 'iMessage' ? 'sent-imessage bg-sent-imessage' : 'sent-other bg-sent-other';
  /**
   * Whether a line is drawn above the message at `index`, and whether it names a day. Asked of the
   * next message as well as this one, because a run has to know where it ends, not only where it
   * began.
   */
  const breakAt = (index: number) => {
    const at = readDate(messages[index]?.createdAt ?? null);
    const was = readDate(messages[index - 1]?.createdAt ?? null);
    if (at === null || index >= messages.length) return { at, newDay: false, opens: false };
    if (was === null) return { at, newDay: index === 0, opens: index === 0 };
    const newDay = dayKey(at) !== dayKey(was);
    return { at, newDay, opens: newDay || at.getTime() - was.getTime() >= BREAK_GAP_MS };
  };
  const sendFeature = capability?.features.send;
  const sendMode: SendMode | null = sendFeature?.state === 'available' ? (sendFeature.reasonCode === 'SEND_DRY_RUN' ? 'dry-run' : 'live') : null;
  return <div className="app h-dvh flex flex-col overflow-hidden bg-surface">
    {epochNotice && <div className="shrink-0 px-4 py-[.65rem] bg-notice text-notice-ink border-b border-notice-line" role="status">{epochNotice}</div>}
    {viewing && <Lightbox item={viewing} onClose={() => setViewing(null)} />}
    <div className="relative flex-1 min-h-0 overflow-hidden pane:grid pane:grid-cols-[minmax(280px,35%)_1fr]">
      <aside className={`chat-pane ${PANE} pane:border-r pane:border-line pane:bg-soft ${selected ? '-translate-x-full invisible' : 'translate-x-0'}`} aria-label="会話一覧">
        <div className={HEADING}><h1 className={PANE_TITLE}>メッセージ</h1></div>
        {chatError && <ErrorBar text={chatError} retry={loadChats} />}
        <div className="chat-area flex-1 min-h-0 overflow-auto flex flex-col" ref={chatViewport} onScroll={onChatScroll}>
          {chatsBusy && chats.length === 0 ? <Empty text="会話を読み込んでいます…" /> : chats.length === 0 ? <Empty text="表示できる会話はありません" /> : <ul className="chat-list list-none m-0 p-0">{chats.map(chat =>
            <li key={chat.id} className="border-b border-line">
              <button className={`flex w-full items-center gap-3 rounded-none px-4 py-[.9rem] text-inherit text-left hover:bg-accent-soft ${selected?.id === chat.id ? 'bg-accent-soft' : 'bg-transparent'}`} onClick={() => choose(chat)}>
                <Avatar name={chat.name} avatarId={chat.avatarId} />
                <span className="min-w-0 grow">
                  <span className="flex justify-between items-start gap-3"><strong className="min-w-0 [overflow-wrap:anywhere]">{chat.name || '名前のない会話'}{chat.trimmed && <span className={TRIM}>（省略）</span>}</strong><time className={STAMP}>{dateLabel(chat.lastMessageAt)}</time></span>
                  <span className="flex justify-between items-center gap-2 mt-[.35rem]">
                    <span className="chat-preview min-w-0 truncate text-muted text-[.8rem]">{chat.preview ? `${chat.preview.fromMe ? '自分: ' : ''}${chat.preview.text}${chat.preview.trimmed ? '…' : ''}` : '\u00a0'}</span>
                    {chat.unreadCount !== null && chat.unreadCount > 0 && <span className="shrink-0 min-w-5 px-1.5 rounded-full bg-accent text-white text-[.7rem] font-bold text-center" aria-label={`未読 ${chat.unreadCount}`}>{chat.unreadCount}</span>}
                  </span>
                </span>
              </button>
            </li>)}</ul>}
          {chats.length > 0 && (chatsPending ? <p className={LIST_NOTE} role="status">読み込んでいます…</p> : chatLimit >= MAX ? <p className={LIST_NOTE}>表示上限の{MAX}件です</p> : null)}
        </div>
      </aside>
      <main className={`detail-pane ${PANE} bg-surface ${selected ? 'translate-x-0' : 'translate-x-full invisible'}`}>{!selected ? <Empty text="会話を選択するとメッセージが表示されます" /> : <>
        <div className={HEADING}>
          <button className="back shrink-0 grid place-items-center w-[42px] h-[42px] p-0 rounded-full text-accent-strong bg-accent-soft pane:hidden" onClick={() => { selectedId.current = null; setSelected(null); setMessages([]); }} aria-label="会話一覧へ戻る"><ArrowLeft24Regular /></button>
          <h1 className={`${PANE_TITLE} min-w-0 flex-1`}>{selected.name || '名前のない会話'}</h1>
        </div>
        {historyError && <ErrorBar text={historyError} retry={loadHistory} />}
        <div className="message-area flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain bg-linear-145 from-thread-from to-thread-to" ref={viewport} onScroll={onScroll} aria-live="polite">
          {messages.length > 0 && <Older pending={olderPending} more={hasOlder} ceiling={messageLimit >= MAX} onMore={loadOlder} />}
          {historyBusy && messages.length === 0 ? <Empty text="メッセージを読み込んでいます…" /> : messages.length === 0 ? <Empty text="メッセージはありません" /> : <ol className="messages list-none m-0 p-4 touch-pan-y select-none pane:select-text"
            style={{ transform: `translateX(${-reveal}px)`, transition: dragging.current ? 'none' : 'transform .18s ease' }}
            onPointerDown={onRevealDown} onPointerMove={onRevealMove} onPointerUp={endReveal} onPointerCancel={endReveal}>{messages.flatMap((message, index) => {
            // A run is one person still talking without a break in between: pulled close together,
            // named once at its start, and with a face at its foot. A line drawn across the
            // conversation ends it — what comes after starts again, and says who is speaking.
            const previous = messages[index - 1], next = messages[index + 1];
            const same = (a: MessageView | undefined) => a !== undefined && a.isFromMe === message.isFromMe && a.sender === message.sender;
            const here = breakAt(index), after = breakAt(index + 1);
            const runs = same(previous) && !here.opens;
            const endsRun = !same(next) || after.opens;
            const facing = selected.isGroup === true && !message.isFromMe;
            // What a message is made of, each piece in a bubble of its own: a picture is not a
            // sentence, and a card is not either, so neither belongs inside the words' padding.
            const tone = message.isFromMe ? sentTone : 'bg-surface';
            const host = message.link ? webHost(message.link.url) : null;
            const parts: Part[] = [
              ...message.attachments.map((item, at) => ({ key: item.id ?? `a${at}`, media: item })),
              ...(message.text || (message.attachments.length === 0 && !host)
                ? [{ key: 'text', text: true as const }] : []),
              ...(message.link && host !== null ? [{ key: 'link', link: message.link, host }] : []),
            ];
            const at = here.at;
            return [
            ...(here.opens ? [<DayBreak key={`day-${message.id}`} at={at!} day={here.newDay} />] : []),
            <li key={message.id} className={`msg relative flex items-end gap-2 ${index === 0 || here.opens ? '' : runs ? 'mt-1' : 'mt-7'} ${message.isFromMe ? 'mine justify-end' : 'theirs'}`}>
              {facing && (endsRun
                ? <Avatar name={message.sender ?? ''} avatarId={message.avatarId} size="w-7 h-7 text-[.7rem]" />
                : <span className="shrink-0 w-7" aria-hidden="true" />)}
              <div className="flex flex-col min-w-0 max-w-[min(88%,720px)] pane:max-w-[min(75%,720px)]">
              {selected.isGroup === true && message.sender && !runs && <span className="sender block mb-[.15rem] ml-[.85rem] text-muted text-[.8em] font-semibold [overflow-wrap:anywhere]">{message.sender}</span>}
              <div className={`flex flex-col gap-1 ${message.isFromMe ? 'items-end' : 'items-start'}`}>
                {parts.map((part, at) => {
                  const shape = corners(message.isFromMe, runs || at > 0);
                  // The quote belongs to the head of the message and the tapbacks to its foot,
                  // wherever those happen to fall among its pieces.
                  const quote = at === 0 && message.replyTo ? <ReplyQuote reply={message.replyTo} /> : null;
                  const tail = at === parts.length - 1 && message.reactions.length > 0 ? <Reactions list={message.reactions} /> : null;
                  if ('media' in part) return <MediaBubble key={part.key} item={part.media} shape={shape} tone={tone} quote={quote} tail={tail} onOpen={setViewing} />;
                  if ('link' in part) return <LinkBubble key={part.key} link={part.link} host={part.host} shape={shape} tone={tone} quote={quote} tail={tail} />;
                  return <div key={part.key} className={`${SHELL} ${shape} ${tone} ${PAD}`}>
                    {quote}
                    <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] leading-normal">{message.text || '本文のないメッセージ'}{message.trimmed && <span className={TRIM}>（省略）</span>}</p>
                    {tail}
                  </div>;
                })}
              </div>
              </div>
              <time className="msg-time absolute left-full top-1/2 -translate-y-1/2 ml-4 w-14 whitespace-nowrap text-muted text-[.7rem]"
                {...(at ? { dateTime: at.toISOString() } : {})}>{at ? TIME.format(at) : '日時不明'}</time>
            </li>];
          })}</ol>}
        </div>
        {sendMode ? <Composer chat={selected} mode={sendMode} send={sendMessage} upload={uploadFile} onSent={() => void loadHistory()} onAuthError={loseSession} />
          : capability === null && capabilityError !== '' ? <ErrorBar text="送信できるか確認できていません。" retry={loadCapabilities} /> : null}
      </>}</main>
    </div>
  </div>;
}

/**
 * The way back in, where someone locked out will look for it: a link, and nothing else, until it
 * is asked for. The command is the wrapper installed beside the releases, so it says the same
 * thing however many times a new one is deployed.
 */
/** One command, what it does, and a way to take it without retyping. */
function Command({ title, command, effect }: { title: string; command: string; effect: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setState('copied'); }
    catch { setState('failed'); }
  };
  return <div className="grid gap-1.5">
    <strong className="text-ink">{title}</strong>
    <div className="relative">
      <pre className="m-0 p-3 pr-12 rounded-lg bg-soft border border-line text-[.78em] whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{command}</pre>
      <button type="button" onClick={() => void copy()} aria-label={`${title}のコマンドをコピー`}
        className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8 p-0 rounded-lg border-0 bg-transparent text-muted hover:text-accent-strong hover:bg-surface">
        {state === 'copied' ? <Checkmark24Regular /> : <Copy24Regular />}
      </button>
      <span className="sr-only" role="status">{state === 'copied' ? 'コピーしました' : ''}</span>
    </div>
    <p className="m-0">{effect}</p>
    {state === 'failed' && <p className="m-0 text-danger" role="alert">コピーできませんでした。手で入力してください。</p>}
  </div>;
}

const CLI = '"$HOME/Library/Application Support/imsg-web/imsg-web"';

/**
 * A screen of its own inside the card rather than an expanding panel: someone who is locked out
 * is reading, not filling in a form, and the form has nothing to offer them until they are done.
 */
function Recovery({ onBack }: { onBack: () => void }) {
  return <div className="grid gap-4 text-[.85rem] text-muted">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="ログイン画面へ戻る"
        className="shrink-0 grid place-items-center w-11 h-11 p-0 rounded-full text-accent-strong bg-accent-soft"><ArrowLeft24Regular /></button>
      <h1 className="m-0 text-[1.25rem] leading-tight text-ink">パスワードを忘れた場合</h1>
    </div>
    <p className="m-0">下のコマンドを、Mac本体のターミナルで実行してください（SSH経由では拒否されます）。どちらも、実行すると全端末でログアウトされます。</p>
    <Command title="1. ログインできるようにする" command={`${CLI} auth rotate`}
      effect="ランダムな43文字のキーが画面に表示されます。それをこのログイン画面のパスワード欄に入力すると入れます。" />
    <Command title="2. 新しいパスワードを決める" command={`${CLI} auth set-password`}
      effect="新しいパスワードの入力を求められます（打っても画面には表示されません）。8文字以上で、英字と数字を1文字以上ずつ含めてください。設定すると、1のキーは使えなくなります。" />
  </div>;
}

/**
 * A conversation's face: the contact's picture when the address book has one, and otherwise the
 * initials over a colour derived from the name, so every row has something to recognise. The
 * colour is decoration — it carries nothing the row does not already say.
 */
function Avatar({ name: rawName, avatarId, size = 'w-11 h-11 text-[.9rem]' }: { name: string; avatarId: string | null; size?: string }) {
  const [failed, setFailed] = useState(false);
  const shape = `chat-avatar shrink-0 ${size} rounded-full object-cover`;
  if (avatarId && !failed) {
    return <img className={shape} src={`/api/avatars/${encodeURIComponent(avatarId)}`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  const name = rawName.trim();
  const initials = [...name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)]
    .slice(0, 2).map(word => [...word][0] ?? '').join('') || '…';
  let hash = 0;
  for (const code of name) hash = (hash * 31 + code.codePointAt(0)!) % 360;
  return <span className={`${shape} grid place-items-center font-bold text-white`}
    style={{ backgroundColor: `oklch(0.55 0.11 ${hash})` }} aria-hidden="true">{initials}</span>;
}

/**
 * Where a day begins, or where a conversation picks up again after a long enough pause. The day is
 * named only when it has changed: repeating 今日 down one afternoon says nothing the time does not.
 */
function DayBreak({ at, day }: { at: Date; day: boolean }) {
  return <li className="day-break my-7 text-center text-[.78rem] text-muted">
    {day && <><strong className="text-ink">{dayLabel(at)}</strong> </>}
    <time dateTime={at.toISOString()}>{TIME.format(at)}</time>
  </li>;
}

function Empty({ text }: { text: string }) { return <div className="empty flex-1 grid place-items-center min-h-[140px] p-8 text-center text-muted" role="status">{text}</div>; }
function ErrorBar({ text, retry }: { text: string; retry: () => Promise<void> }) { return <div className="error-bar flex items-center justify-between gap-3 px-4 py-[.65rem] bg-danger-soft text-danger text-[.85rem]" role="alert"><span>{text}</span><button className="btn-secondary btn-compact" onClick={() => void retry()}>再試行</button></div>; }
/**
 * Sits above the oldest message, so it is out of sight until the owner scrolls up to it —
 * by which point scrolling has usually already asked for the next page. The button is the
 * fallback for when it has not: a list too short to scroll, or a read that failed.
 */
function Older({ pending, more, ceiling, onMore }: { pending: boolean; more: boolean; ceiling: boolean; onMore: () => void }) {
  return <div className={LIST_NOTE}>{
    pending ? <span role="status">以前のメッセージを読み込んでいます…</span>
    : ceiling ? <span>表示上限の{MAX}件です</span>
    : more ? <button className="btn-secondary btn-compact" onClick={onMore}>以前のメッセージを読み込む</button>
    : <span>これより前のメッセージはありません</span>}</div>;
}
