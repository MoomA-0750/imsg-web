import { CSSProperties, FormEvent, PointerEvent, ReactNode, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Add24Regular, ArrowLeft24Regular, Checkmark24Regular, Copy24Regular, Dismiss12Regular, Mic24Filled, Pause24Filled, Person24Filled, Play24Filled, Send24Filled, Stop24Filled } from '@fluentui/react-icons';
import type { AttachmentView, CapabilitySnapshot, ChatSnapshot, ChatView, HistorySnapshot, LinkView, MessageView, ReactionView, ReplyView } from '../../src/shared/web-types';
import { RECORD_MAX_MS, RecorderError, VoiceRecorder } from './recorder';

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
/** How far in an opened picture may be taken. */
const ZOOM_MAX = 6;
/** How long a message stays marked after the screen goes to it. */
const MARK_MS = 2000;
/** How long a word about a jump stays on screen. */
const NOTE_MS = 4000;
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

const ATTACHMENT_LABEL = { image: '画像', audio: '音声', video: '動画', file: '添付ファイル' } as const;
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
  if (item.kind === 'audio' && item.id && !failed) {
    return <div className={`${SHELL} ${shape} ${tone} ${PAD} w-fit`}>
      {quote}
      <AudioPlayer src={`/api/attachments/${encodeURIComponent(item.id)}`} onFail={() => setFailed(true)} label="音声メッセージ" />
      {tail}
    </div>;
  }
  if (item.kind !== 'audio' && item.id && !failed) {
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
  const reason = item.preview || !item.id
    ? (item.kind === 'image' ? 'このMacに保存されていないか、表示できない形式です'
      : item.kind === 'audio' ? 'このMacに保存されていないか、再生できない形式です'
      : 'この画面では表示できません')
    : item.kind === 'audio' ? 'このブラウザでは再生できない形式です' : 'このブラウザでは表示できない形式です';
  return <div className={`${SHELL} ${shape} ${tone} ${PAD}`}>
    {quote}
    <p className="attachment m-0 text-muted text-[.9em]">{ATTACHMENT_LABEL[item.kind]}（{reason}）</p>
    {tail}
  </div>;
}

/** mm:ss, the way a length of talking is always written. An unknown length says so rather than lying. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A voice message, played where it sits. The bar is the length of the recording and fills as it
 * plays; pressing anywhere along it moves to that point, which is the whole reason to draw a bar
 * rather than a spinner. Only one plays at a time — the browser is told to pause the others.
 *
 * The file itself is fetched only when it is played, so a conversation full of voice messages costs
 * nothing to scroll past. Audio the Mac cannot convert never arrives, and the bubble says so.
 */
function AudioPlayer({ src, onFail, compact, label = '録音' }: { src: string; onFail: () => void; compact?: boolean; label?: string }) {
  const sound = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(Number.NaN);
  const done = Number.isFinite(length) && length > 0 ? Math.min(1, at / length) : 0;

  const toggle = () => {
    const el = sound.current;
    if (!el) return;
    if (el.paused) {
      for (const other of document.querySelectorAll('audio')) if (other !== el) other.pause();
      void el.play().catch(() => onFail());
    } else el.pause();
  };
  /** Where along the bar it was pressed, as a share of the whole. */
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const el = sound.current;
    if (!el || !Number.isFinite(length) || length <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    el.currentTime = Math.min(length, Math.max(0, (event.clientX - box.left) / box.width * length));
    setAt(el.currentTime);
  };

  const time = <span className="voice-time text-muted text-[.75rem] tabular-nums">{clock(playing || at > 0 ? at : length)}</span>;
  return <div className={`voice flex items-center gap-3 ${compact ? '' : 'min-w-[12rem] max-w-[16rem]'}`}>
    <button type="button" className="shrink-0 grid place-items-center w-9 h-9 p-0 rounded-full border-0 bg-accent text-white"
      onClick={toggle} aria-label={`${label}を${playing ? '一時停止' : '再生'}`}>{playing ? <Pause24Filled /> : <Play24Filled />}</button>
    {compact ? time : <div className="grow min-w-0">
      <div className="voice-bar h-1.5 rounded-full bg-accent-soft cursor-pointer" onPointerDown={seek}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${done * 100}%` }} />
      </div>
      <span className="block mt-1">{time}</span>
    </div>}
    {/* preload="metadata" so the bar has a length before anyone presses play, but no audio is fetched. */}
    <audio ref={sound} src={src} preload="metadata"
      onLoadedMetadata={event => setLength(event.currentTarget.duration)}
      onTimeUpdate={event => setAt(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setAt(0); }} onError={onFail} />
  </div>;
}

/**
 * The picture on its own, as large as the screen allows, and as close as the owner wants: the wheel
 * or a pinch scales it about whatever is under the pointer, and a drag moves it once there is more
 * of it than fits. At its natural size a drag means something else — pulling it down puts it away —
 * so the two never compete for the same gesture.
 */
function Lightbox({ item, onClose }: { item: AttachmentView; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [pulled, setPulled] = useState(0);
  const frame = useRef<HTMLDivElement | null>(null);
  const picture = useRef<HTMLImageElement | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ gap: number; x: number; y: number } | undefined>(undefined);
  const from = useRef<{ x: number; y: number } | undefined>(undefined);
  /**
   * What the gesture that is ending was. Capturing the pointer sends the click that follows to the
   * frame whatever it began on, so the frame has to remember for itself: a click closes only when
   * it was a click, on the space around the picture, and not the tail of a drag.
   */
  const gesture = useRef({ moved: false, onPicture: false });

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  /** Panning stops where the picture does: there is no sense dragging empty space into view. */
  const settle = (scale: number, x: number, y: number) => {
    const img = picture.current, hold = frame.current;
    if (!img || !hold) return { scale, x, y };
    const roomX = Math.max(0, (img.offsetWidth * scale - hold.clientWidth) / 2);
    const roomY = Math.max(0, (img.offsetHeight * scale - hold.clientHeight) / 2);
    return { scale, x: Math.min(roomX, Math.max(-roomX, x)), y: Math.min(roomY, Math.max(-roomY, y)) };
  };

  /**
   * Scales about (x, y): whatever is under the pointer stays under it, which is what makes zooming
   * feel aimed rather than arbitrary. Every decision is made from the state being replaced, so a
   * burst of wheel or pinch events cannot compound against a scale that has not been drawn yet.
   */
  const zoom = (next: (current: number) => number, x: number, y: number) => setView(was => {
    const hold = frame.current;
    const scale = Math.min(ZOOM_MAX, Math.max(1, next(was.scale)));
    if (!hold || scale === was.scale) return was;
    const box = hold.getBoundingClientRect();
    const centreX = box.left + box.width / 2, centreY = box.top + box.height / 2;
    // Where the pointer is on the picture itself, in its unscaled coordinates.
    const onX = (x - centreX - was.x) / was.scale, onY = (y - centreY - was.y) / was.scale;
    return settle(scale, x - centreX - onX * scale, y - centreY - onY * scale);
  });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // Registered by hand: the wheel must not scroll the page instead, and only a listener that says
    // so when it is added may prevent that.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(current => current * Math.exp(-event.deltaY / 400), event.clientX, event.clientY);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoom reads nothing but refs and the updater's own state
  }, []);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { moved: false, onPicture: event.target === picture.current };
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2) { pinch.current = spread(touches.current); from.current = undefined; return; }
    from.current = view.scale > 1
      ? { x: event.clientX - view.x, y: event.clientY - view.y }
      : { x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size >= 2) {
      const now = spread(touches.current), was = pinch.current;
      pinch.current = now;
      if (was) zoom(current => current * (now.gap / was.gap), now.x, now.y);
      return;
    }
    const start = from.current;
    if (!start) return;
    if (view.scale > 1) {
      gesture.current.moved = true;
      setView(was => settle(was.scale, event.clientX - start.x, event.clientY - start.y));
      return;
    }
    const pull = Math.max(0, event.clientY - start.y);
    if (pull > 4) gesture.current.moved = true;
    setPulled(pull);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = undefined;
    if (touches.current.size > 0) return;
    const pulling = from.current !== undefined && view.scale <= 1;
    from.current = undefined;
    if (pulling && pulled > PULL_CLOSE) onClose(); else setPulled(0);
  };

  const zoomed = view.scale > 1;
  return <div ref={frame} className="lightbox fixed inset-0 z-50 flex items-center justify-center p-4 touch-none overflow-hidden"
    style={{ backgroundColor: `rgb(0 0 0 / ${Math.max(0.35, 0.85 - pulled / 500)})` }}
    role="dialog" aria-modal="true" aria-label="画像"
    onClick={() => { if (!gesture.current.moved && !gesture.current.onPicture) onClose(); }}
    onDoubleClick={event => zoom(current => (current > 1 ? 1 : 2.5), event.clientX, event.clientY)}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {/* Sized against the window rather than the box around it: a grid or flex track measured from
        the picture cannot also constrain it, which let a tall one run off the screen. */}
    <img ref={picture} className={`max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] object-contain ${zoomed ? 'cursor-grab' : ''}`}
      style={{ transform: `translate(${view.x}px, ${view.y + pulled}px) scale(${view.scale})`,
        opacity: Math.max(0, 1 - pulled / 400),
        transition: from.current === undefined && pinch.current === undefined ? 'transform .18s ease, opacity .18s ease' : 'none' }}
      src={`/api/attachments/${encodeURIComponent(item.id!)}`} alt="添付画像" draggable={false} />
    <button type="button" className="absolute top-4 right-4 grid place-items-center w-11 h-11 p-0 rounded-full border-0 bg-white/15 text-white" onClick={onClose} aria-label="閉じる" autoFocus><Dismiss12Regular /></button>
  </div>;
}

/** The distance between two pointers, and the point between them. */
function spread(points: Map<number, { x: number; y: number }>) {
  const [a, b] = [...points.values()];
  return { gap: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
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

/**
 * What a message is answering, and the way back to it: pressing the quote goes to the message it
 * came from and marks it for a moment, which is the only way to tell one of several similar-looking
 * messages from the others once the screen has moved.
 */
function ReplyQuote({ reply, onGo }: { reply: ReplyView; onGo: (messageId: string) => void }) {
  return <button type="button" onClick={() => onGo(reply.messageId)}
    className="reply-quote block w-full m-0 mb-[.35rem] last:mb-0 px-2 py-[.3rem] border-0 border-l-[3px] border-line rounded-none rounded-r-lg bg-soft text-muted text-[.85em] text-left whitespace-pre-wrap [overflow-wrap:anywhere] hover:bg-accent-soft"
    aria-label={`返信元へ移動: ${reply.sender ?? '自分'}`}>
    <span className="block font-semibold text-[.92em]">{reply.sender ?? '自分'}</span>{reply.text}{reply.trimmed && <span className="text-muted text-[.75em]">（省略）</span>}
  </button>;
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

/** Something waiting to be sent: a file the owner picked, or a recording they just made here. */
type Chosen = { file: File; voice?: true; seconds?: number };

/**
 * A chosen file as a rounded square, with the file name only as its tooltip and alternative text —
 * the picture is the identification. A recording has no picture to show, so it shows its length and
 * plays back instead. The object URL is revoked when the choice changes.
 */
function Thumbnail({ chosen, onRemove, disabled }: { chosen: Chosen; onRemove: () => void; disabled: boolean }) {
  const { file } = chosen;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const playable = chosen.voice === true;
  useEffect(() => {
    if (!file.type.startsWith('image/') && !playable) return;
    const created = URL.createObjectURL(file);
    setUrl(created); setFailed(false);
    return () => { URL.revokeObjectURL(created); setUrl(null); };
  }, [file, playable]);
  const shape = 'composer-thumb block w-16 h-16 rounded-xl border border-line object-cover bg-soft';
  const label = `${file.name}（${sizeLabel(file.size)}）`;
  const remove = <button type="button" aria-label={`${playable ? '録音' : file.name} を外す`} disabled={disabled}
    className="absolute -top-1.5 -right-1.5 grid place-items-center w-5 h-5 rounded-full border border-line bg-surface text-muted enabled:hover:text-ink"
    onClick={onRemove}><Dismiss12Regular /></button>;
  if (playable) {
    // Listened back to before it goes: a recording nobody can hear first is a message sent blind.
    return <div className="composer-voice relative shrink-0 h-16 flex items-center px-3 rounded-xl border border-line bg-soft" title={label}>
      {url && !failed
        ? <AudioPlayer src={url} onFail={() => setFailed(true)} compact />
        : <span className="text-[.7rem] text-muted">音声</span>}
      {remove}
    </div>;
  }
  return <div className="relative shrink-0" title={label}>
    {/* Nothing is uploaded to draw this; a format the browser cannot decode (HEIC) falls back to a word. */}
    {url && !failed
      ? <img className={shape} src={url} alt={label} onError={() => setFailed(true)} />
      : <span className={`${shape} placeholder flex items-center justify-center text-center text-[.65rem] text-muted`}>{file.type.startsWith('image/') ? '画像' : 'ファイル'}</span>}
    {remove}
  </div>;
}

/**
 * What is heard while it is being heard: the time so far, and a bar that answers to the room. The
 * level is what says the microphone is actually picking something up — a timer alone counts just as
 * happily through silence.
 */
function RecordingStrip({ since, level }: { since: number; level: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, (now - since) / 1000);
  return <div className="recording grow min-w-0 h-11 flex items-center gap-3 px-4 rounded-[1.375rem] border border-field bg-surface" role="status" aria-label="録音中">
    <span className="shrink-0 w-2.5 h-2.5 rounded-full bg-danger animate-pulse" aria-hidden="true" />
    <span className="recording-time shrink-0 text-[.9rem] tabular-nums">{clock(seconds)}</span>
    <span className="grow min-w-0 h-1.5 rounded-full bg-accent-soft overflow-hidden" aria-hidden="true">
      <span className="block h-full rounded-full bg-accent transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(level * 140))}%` }} />
    </span>
  </div>;
}

function Composer({ chat, mode, send, upload, onSent, onAuthError }: { chat: ChatView; mode: SendMode; send: (chatId: string, text: string, uploadIds: string[]) => Promise<SendResult>; upload: (file: File, voice?: boolean) => Promise<{ uploadId: string }>; onSent: () => void; onAuthError: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Chosen[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [recording, setRecording] = useState<{ since: number; level: number } | null>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
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
      if (merged.some(have => have.file.name === file.name && have.file.size === file.size && have.file.lastModified === file.lastModified)) continue;
      if (merged.length >= FILES_MAX) { overflow = true; continue; }
      merged.push({ file });
    }
    setFiles(merged);
    setNotice(overflow ? { kind: 'warn', text: `添付は${FILES_MAX}件までです。超えた分は追加していません。` } : null);
  };

  /**
   * Recording runs until it is stopped, or until the ceiling. Whatever was heard becomes another
   * attachment, so it is listened back to, removed, or sent with a message like anything else — and
   * nothing is sent by the act of recording it.
   */
  const startRecording = async () => {
    if (recorder.current || busy) return;
    if (files.length >= FILES_MAX) { setNotice({ kind: 'warn', text: `添付は${FILES_MAX}件までです。` }); return; }
    const machine = new VoiceRecorder(level => setRecording(now => (now ? { ...now, level } : now)));
    recorder.current = machine;
    setNotice(null);
    try {
      await machine.start();
      setRecording({ since: Date.now(), level: 0 });
    } catch (error) {
      recorder.current = null;
      const problem = error instanceof RecorderError ? error.problem : 'failed';
      setNotice({ kind: 'error', text: problem === 'denied' ? 'マイクの使用が許可されていません。ブラウザーの設定で許可してください。'
        : problem === 'unsupported' ? 'このブラウザーでは録音できません。' : '録音を開始できませんでした。' });
    }
  };
  const finishRecording = async (keep: boolean) => {
    const machine = recorder.current;
    recorder.current = null; setRecording(null);
    const heard = await machine?.stop().catch(() => null);
    if (!keep || !heard) return;
    if (heard.seconds < 0.4) { setNotice({ kind: 'warn', text: '短すぎたので録音は残していません。' }); return; }
    setFiles(rest => [...rest, { file: heard.file, voice: true, seconds: heard.seconds }]);
  };
  // Leaving the conversation, or the screen, closes the microphone: it must never outlive the view
  // that opened it.
  useEffect(() => {
    setText(''); setFiles([]); setBusy(false); setNotice(null); setRecording(null);
    return () => { const machine = recorder.current; recorder.current = null; void machine?.stop(); };
  }, [chat.id]);
  // The ceiling stops it by itself, so a recording left running does not grow without end.
  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => { void finishRecording(true); }, Math.max(0, RECORD_MAX_MS - (Date.now() - recording.since)));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the start of a recording matters here
  }, [recording?.since]);

  const dispatch = async () => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      // Every attachment is uploaded first; the send then refers to them by opaque ids.
      const ids: string[] = [];
      for (const chosen of files) ids.push((await upload(chosen.file, chosen.voice)).uploadId);
      const result = await send(chat.id, text, ids);
      // Several attachments are several messages, so a batch can stop part way; say exactly how far it got.
      const done = result.sent ?? 0, total = result.total ?? 0;
      const progress = total > 1 ? `${total}件中${done}件を送信しました。` : '';
      // Nothing is said when a send works: the message appearing in the conversation, and the
      // composer emptying, is the whole of the news. Only what went wrong is worth a line.
      if (result.state === 'sent') { setText(''); clearFiles(); onSent(); }
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
  const listening = recording !== null;
  // No confirmation step: the owner asked for sending to be immediate. Double submission is still
  // held off while one is in flight, and every outcome is reported honestly.
  const submit = () => { if (ready && !busy) void dispatch(); };
  return <form className="composer shrink-0 flex flex-col gap-2 px-4 py-[.7rem] border-t border-line bg-surface" onSubmit={event => { event.preventDefault(); submit(); }}>
    {mode === 'dry-run' && <p className="m-0 text-muted text-[.8rem]" role="status">テスト送信モードです。実際には送信されません。</p>}
    <input ref={picker} type="file" hidden multiple aria-label="添付ファイルを選ぶ" onChange={event => { const chosen = [...(event.target.files ?? [])]; event.target.value = ''; addFiles(chosen); }} />
    {files.length > 0 && <ul className="composer-files list-none m-0 p-0 flex flex-wrap gap-2">{files.map((chosen, index) =>
      <li key={`${chosen.file.name}:${index}`}><Thumbnail chosen={chosen} disabled={busy} onRemove={() => setFiles(rest => rest.filter((_, at) => at !== index))} /></li>)}</ul>}
    {notice && <p className={`m-0 text-[.85rem] ${NOTICE_COLOUR[notice.kind]}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    <div className="flex items-end gap-2">
      {/* While recording the left button abandons it instead of opening the file picker: the two
          things one could mean there are keep it and drop it, and both are within reach. */}
      <button type="button" className={`${ROUND} border border-line bg-soft ${listening ? 'text-danger' : 'text-accent-strong'} enabled:hover:bg-accent-soft`}
        onClick={() => (listening ? void finishRecording(false) : picker.current?.click())} disabled={busy}
        aria-label={listening ? '録音をやめる' : '添付ファイルを追加'}>{listening ? <Dismiss12Regular /> : <Add24Regular />}</button>
      {listening
        ? <RecordingStrip since={recording.since} level={recording.level} />
        : <textarea ref={field} className="grow min-w-0 resize-none h-11 min-h-11 max-h-48 overflow-y-auto rounded-[1.375rem] border border-field px-4 py-[.55rem] leading-6 bg-surface text-inherit"
            value={text} onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }}
            placeholder={chat.service === 'iMessage' ? 'iMessage' : 'SMS'} rows={1} maxLength={8000} aria-label="メッセージを入力" disabled={busy} />}
      {/* One button on the right, saying what it would do now: record while there is nothing to
          send, stop while recording, and send once there is something. */}
      {/* Each is its own element rather than one button that changes its mind: reusing the node
          would carry a press made on one of them into whatever it became next. */}
      {listening
        ? <button key="stop" type="button" className={`${ROUND} border-0 bg-danger text-white`} onClick={() => void finishRecording(true)} aria-label="録音を終える"><Stop24Filled /></button>
        : ready
          ? <button key="send" type="submit" className={`${ROUND} border-0 bg-accent text-white enabled:hover:bg-accent-strong`} disabled={busy} aria-label={busy ? '送信中' : '送信'}><Send24Filled /></button>
          : <button key="record" type="button" className={`${ROUND} border border-line bg-soft text-accent-strong enabled:hover:bg-accent-soft`} onClick={() => void startRecording()} disabled={busy} aria-label="音声を録音"><Mic24Filled /></button>}
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
  /** Where each drawn message is, so the screen can go back to one a reply names. */
  const rows = useRef(new Map<string, HTMLLIElement>());
  /** The message being pointed out, until the mark fades. */
  const [marked, setMarked] = useState<string | null>(null);
  const markTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A message asked for that had not been read yet; looked for again once more of them arrive. */
  const wanted = useRef<string | null>(null);
  const [jumpNote, setJumpNote] = useState('');
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

  /**
   * Goes to a message and marks it for a moment. A conversation is opened at its newest page, so
   * the message a reply answers is often further back than has been read: in that case the rest is
   * asked for once, up to the ceiling, and the search resumes when it lands. Following the newest
   * message stops either way — the owner has just asked to be somewhere else.
   */
  const show = useCallback((messageId: string) => {
    const row = rows.current.get(messageId);
    if (!row) return false;
    following.current = false;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setMarked(messageId);
    clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => setMarked(null), MARK_MS);
    return true;
  }, []);

  const goToMessage = useCallback((messageId: string) => {
    setJumpNote('');
    if (show(messageId)) return;
    if (messageLimit >= MAX) { setJumpNote(`このメッセージより前は表示できません（上限${MAX}件）。`); return; }
    following.current = false;
    wanted.current = messageId;
    setJumpNote('返信元を探しています…');
    setMessageLimit(MAX);
  }, [messageLimit, show]);

  // The larger page has landed: go to what was asked for, or say it is not in the conversation.
  useLayoutEffect(() => {
    const target = wanted.current;
    if (target === null || messages.length === 0) return;
    wanted.current = null;
    setJumpNote(show(target) ? '' : '返信元のメッセージは見つかりませんでした。');
  }, [messages, show]);

  useEffect(() => () => clearTimeout(markTimer.current), []);
  // A note about a jump belongs to the jump, not to the conversation: it goes when it is stale.
  useEffect(() => {
    if (jumpNote === '' || jumpNote.endsWith('…')) return;
    const timer = setTimeout(() => setJumpNote(''), NOTE_MS);
    return () => clearTimeout(timer);
  }, [jumpNote]);

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

  const uploadFile = useCallback(async (file: File, voice?: boolean): Promise<{ uploadId: string }> => {
    const token = session?.csrfToken;
    if (!token) { const error = new Error('no session') as ApiError; error.status = 401; throw error; }
    // Raw bytes, streamed: no base64 inflation. octet-stream cannot come from an HTML form, so CSRF cover is unchanged.
    // A recording says so, so the server knows it may re-encode this one and nothing else.
    return api<{ uploadId: string }>(`/api/uploads?name=${encodeURIComponent(file.name)}${voice ? '&voice=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': token }, body: file });
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
    wanted.current = null; setMarked(null); setJumpNote('');
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
                <Avatar name={chat.name} faces={chat.faces} />
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
        {jumpNote && <p className="jump-note shrink-0 m-0 px-4 py-[.55rem] bg-notice text-notice-ink text-[.85rem] text-center border-b border-notice-line" role="status">{jumpNote}</p>}
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
            <li key={message.id} ref={element => { if (element) rows.current.set(message.id, element); else rows.current.delete(message.id); }}
              className={`msg relative flex items-end gap-2 ${index === 0 || here.opens ? '' : runs ? 'mt-1' : 'mt-7'} ${message.isFromMe ? 'mine justify-end' : 'theirs'} ${marked === message.id ? 'marked' : ''}`}>
              {facing && (endsRun
                ? <Avatar name={message.sender ?? ''} faces={[message.avatarId]} size="w-7 h-7 text-[.7rem]" />
                : <span className="shrink-0 w-7" aria-hidden="true" />)}
              <div className="flex flex-col min-w-0 max-w-[min(88%,720px)] pane:max-w-[min(75%,720px)]">
              {selected.isGroup === true && message.sender && !runs && <span className="sender block mb-[.15rem] ml-[.85rem] text-muted text-[.8em] font-semibold [overflow-wrap:anywhere]">{message.sender}</span>}
              <div className={`flex flex-col gap-1 ${message.isFromMe ? 'items-end' : 'items-start'}`}>
                {parts.map((part, at) => {
                  const shape = corners(message.isFromMe, runs || at > 0);
                  // The quote belongs to the head of the message and the tapbacks to its foot,
                  // wherever those happen to fall among its pieces.
                  const quote = at === 0 && message.replyTo ? <ReplyQuote reply={message.replyTo} onGo={goToMessage} /> : null;
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
 * Where each member sits in a group's face, as a share of the whole: the first slot largest, the
 * rest gathered round it. Deliberately not a neat ring — a little unevenness reads as a handful of
 * people rather than a diagram of them.
 */
const CLUSTER: Record<number, readonly { size: number; x: number; y: number }[]> = {
  2: [{ size: 70, x: 0, y: 2 }, { size: 60, x: 40, y: 38 }],
  3: [{ size: 62, x: 0, y: 4 }, { size: 52, x: 48, y: 0 }, { size: 56, x: 26, y: 44 }],
  4: [{ size: 56, x: 0, y: 0 }, { size: 52, x: 48, y: 2 }, { size: 50, x: 2, y: 50 }, { size: 54, x: 46, y: 46 }],
};

/**
 * A conversation's face: the contact's picture when the address book has one, and otherwise the
 * initials over a colour derived from the name, so every row has something to recognise. The
 * colour is decoration — it carries nothing the row does not already say.
 *
 * A group is its members' faces gathered together, since a group has no picture of its own. Every
 * member gets a place whether or not there is a picture for them, so the face says how many people
 * are in there; the ones it knows come first, and the rest are drawn as the strangers they are.
 */
function Avatar({ name, faces, size = 'w-11 h-11 text-[.9rem]' }: { name: string; faces: (string | null)[]; size?: string }) {
  const shape = `chat-avatar shrink-0 ${size} rounded-full object-cover`;
  if (faces.length < 2) return <Face id={faces[0] ?? null} name={name} className={shape} />;
  const places = CLUSTER[Math.min(faces.length, 4)]!;
  return <span className={`chat-avatar relative shrink-0 ${size} block`} aria-hidden="true">
    {faces.slice(0, places.length).map((id, at) => {
      const place = places[at]!;
      return <Face key={at} id={id} name="" small
        className="absolute rounded-full object-cover ring-2 ring-surface"
        style={{ width: `${place.size}%`, height: `${place.size}%`, left: `${place.x}%`, top: `${place.y}%` }} />;
    })}
  </span>;
}

/** One face in its place: the picture, the initials, or — for a member with no name — a stranger. */
function Face({ id, name: rawName, className, style, small }: { id: string | null; name: string; className: string; style?: CSSProperties; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (id && !failed) {
    return <img className={className} style={style} src={`/api/avatars/${encodeURIComponent(id)}`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  const name = rawName.trim();
  if (name === '') {
    return <span className={`${className} grid place-items-center bg-accent-soft text-muted`} style={style} aria-hidden="true">
      <Person24Filled className="w-[62%] h-[62%]" />
    </span>;
  }
  const initials = [...name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)]
    .slice(0, 2).map(word => [...word][0] ?? '').join('') || '…';
  let hash = 0;
  for (const code of name) hash = (hash * 31 + code.codePointAt(0)!) % 360;
  return <span className={`${className} grid place-items-center font-bold text-white ${small ? 'text-[.6rem]' : ''}`}
    style={{ ...style, backgroundColor: `oklch(0.55 0.11 ${hash})` }} aria-hidden="true">{initials}</span>;
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
