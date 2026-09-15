import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentView, CapabilitySnapshot, ChatSnapshot, ChatView, HistorySnapshot, LinkView, MessageView } from '../../src/shared/web-types';

const PAGE = 50;
const MAX = 1000;
const POLL_MS = 15_000;

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

function dateLabel(value: string | null): string {
  if (!value) return '日時不明';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

const ATTACHMENT_LABEL = { image: '画像', video: '動画', file: '添付ファイル' } as const;

function Attachment({ item }: { item: AttachmentView }) {
  const [failed, setFailed] = useState(false);
  if (item.id && !failed) {
    const image = <img className={item.sticker ? 'attachment-image sticker' : 'attachment-image'} src={`/api/attachments/${encodeURIComponent(item.id)}`} alt={item.preview ? '添付画像のサムネイル' : '添付画像'} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
    return item.preview ? <figure className="attachment-preview">{image}<figcaption>サムネイル（元の画像はこのMacにありません）</figcaption></figure> : image;
  }
  const reason = item.preview || !item.id ? (item.kind === 'image' ? 'このMacに保存されていないか、表示できない形式です' : 'この画面では表示できません') : 'このブラウザでは表示できない形式です';
  return <p className="attachment">{ATTACHMENT_LABEL[item.kind]}（{reason}）</p>;
}

function LinkCard({ link }: { link: LinkView }) {
  const [imageFailed, setImageFailed] = useState(false);
  let host: string;
  try {
    const url = new URL(link.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    host = url.hostname;
  } catch { return null; }
  const imageId = link.image?.id;
  return <a className="link-card" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
    {imageId && !imageFailed && <img src={`/api/attachments/${encodeURIComponent(imageId)}`} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />}
    <span className="link-body"><strong>{link.title || host}</strong>{link.summary && <span className="link-summary">{link.summary}</span>}<span className="link-site">{link.siteName && link.siteName !== host ? `${link.siteName} · ${host}` : host}</span></span>
  </a>;
}

type SendResult = { state: 'sent' | 'failed' | 'unknown' | 'dry_run'; sent?: number; total?: number };
type SendMode = 'live' | 'dry-run';

const MiB = 1024 * 1024;
const sizeLabel = (bytes: number) => bytes >= MiB ? `${(bytes / MiB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const FILES_MAX = 10;

/** A local preview of a chosen file; the object URL is revoked when the choice changes. */
function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const created = URL.createObjectURL(file);
    setUrl(created); setFailed(false);
    return () => { URL.revokeObjectURL(created); setUrl(null); };
  }, [file]);
  // Nothing is uploaded to draw this, and a format the browser cannot decode (HEIC) falls back to the name.
  if (url && !failed) return <img className="composer-thumb" src={url} alt="" onError={() => setFailed(true)} />;
  return <span className="composer-thumb placeholder" aria-hidden="true">{file.type.startsWith('image/') ? '画像' : 'ファイル'}</span>;
}

function Composer({ chat, mode, send, upload, onSent, onAuthError }: { chat: ChatView; mode: SendMode; send: (chatId: string, text: string, uploadIds: string[]) => Promise<SendResult>; upload: (file: File) => Promise<{ uploadId: string }>; onSent: () => void; onAuthError: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
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
  return <form className="composer" onSubmit={event => { event.preventDefault(); submit(); }}>
    {mode === 'dry-run' && <p className="composer-banner" role="status">テスト送信モードです。実際には送信されません。</p>}
    <textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }} placeholder="メッセージを入力（Ctrl+Enter / ⌘+Enter で送信）" rows={2} maxLength={8000} aria-label="メッセージを入力" disabled={busy} />
    <input ref={picker} type="file" hidden multiple aria-label="添付ファイルを選ぶ" onChange={event => { const chosen = [...(event.target.files ?? [])]; event.target.value = ''; addFiles(chosen); }} />
    {files.length > 0 && <ul className="composer-files">{files.map((file, index) => <li key={`${file.name}:${index}`}><Thumbnail file={file} /><span className="composer-file-name">{file.name}（{sizeLabel(file.size)}）</span><button type="button" className="secondary compact" onClick={() => setFiles(rest => rest.filter((_, at) => at !== index))} disabled={busy}>外す</button></li>)}</ul>}
    {files.length > 1 && <p className="composer-banner">添付は1件ずつ別のメッセージとして送られます。</p>}
    {notice && <p className={`composer-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    <div className="composer-actions"><button type="button" className="secondary" onClick={() => picker.current?.click()} disabled={busy}>添付</button><button type="submit" disabled={busy || !ready}>{busy ? '送信中…' : '送信'}</button></div>
  </form>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [chats, setChats] = useState<ChatView[]>([]);
  const [chatLimit, setChatLimit] = useState(PAGE);
  const [selected, setSelected] = useState<ChatView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [messageLimit, setMessageLimit] = useState(PAGE);
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
    setChatLimit(PAGE); setMessageLimit(PAGE);
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
    const started = generation.current;
    setChatsBusy(true);
    try {
      await run('chats', async signal => {
        const data = await api<ChatSnapshot>(`/api/chats?limit=${chatLimit}`, { signal });
        if (!switchEpoch(data.epoch, started) || started !== generation.current) return;
        setChats(data.chats.slice(0, MAX)); setChatError(''); setEpochNotice('');
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
    const started = generation.current;
    setHistoryBusy(true);
    try {
      await run('history', async signal => {
        const data = await api<HistorySnapshot>(`/api/chats/${encodeURIComponent(id)}/messages?limit=${messageLimit}`, { signal });
        if (selectedId.current !== id || !switchEpoch(data.epoch, started) || started !== generation.current) return;
        setMessages(data.messages.slice(0, MAX)); setHistoryError('');
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

  async function login(event: FormEvent) {
    event.preventDefault();
    if (logoutBusy) return;
    setLoginBusy(true); setLoginError('');
    try {
      const value = await api<Session>('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      setKey(''); clearPrivate(); setSession(value);
    } catch (error) {
      setLoginError((error as ApiError).status === 401 ? 'キーが正しくありません。' : (error as ApiError).status === 429 ? '試行回数が多すぎます。しばらく待ってください。' : 'ログインできませんでした。');
    } finally { setLoginBusy(false); }
  }

  async function logout() {
    const token = session?.csrfToken;
    setLogoutBusy(true);
    clearPrivate(); setSession(null); setKey('');
    if (!token) { setLogoutBusy(false); return; }
    try {
      await api<unknown>('/api/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' });
      setLoginError('');
    } catch {
      setLoginError('端末上の表示は消去しましたが、サーバーのセッション失効は未確認です。Macの管理CLIで auth revoke-all を実行してください。再ログインだけでは元のセッションは失効しません。');
    } finally { setLogoutBusy(false); }
  }

  function choose(chat: ChatView) {
    inFlight.current.history?.abort(); delete inFlight.current.history;
    selectedId.current = chat.id; setSelected(chat); setMessages([]); setHistoryError(''); setMessageLimit(PAGE);
  }

  if (checking) return <main className="center"><p role="status">セッションを確認しています…</p></main>;
  if (!session) return <main className="center"><section className="login-card" aria-labelledby="login-title"><div className="brand">imsg Web</div><h1 id="login-title">メッセージを見る</h1><p className="muted">所有者キーでログインしてください。このアプリはキーを保存しません（ブラウザーへの保存はご自身で選べます）。</p><form onSubmit={login}><label htmlFor="owner-key">所有者キー</label><input id="owner-key" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required autoFocus /><button disabled={loginBusy || logoutBusy}>{logoutBusy ? 'ログアウト処理中…' : loginBusy ? '確認中…' : 'ログイン'}</button>{loginError && <p className="error" role="alert">{loginError}</p>}</form></section></main>;

  const featureValues = capability ? Object.values(capability.features) : [];
  const availableCount = featureValues.filter(value => value.state === 'available').length;
  const sendFeature = capability?.features.send;
  const sendMode: SendMode | null = sendFeature?.state === 'available' ? (sendFeature.reasonCode === 'SEND_DRY_RUN' ? 'dry-run' : 'live') : null;
  return <div className={`app ${selected ? 'show-detail' : ''}`}>
    <header><div><strong>imsg Web</strong><span className="mode">閲覧専用・15秒更新</span></div><div className="header-actions"><span className="capability" title={capabilityError || '利用可能な機能'}>{capability ? `機能 ${availableCount}/${featureValues.length}` : capabilityError || '機能確認中'}</span><button className="secondary compact" onClick={() => void logout()}>ログアウト</button></div></header>
    {featureValues.some(feature => feature.reasonCode === 'STATUS_PROBE_DISABLED') && <p role="status">既読・入力中の機能状態は未確認です。安全に確認する機能はまだ実装されていません。</p>}
    {epochNotice && <div className="notice" role="status">{epochNotice}</div>}
    <div className="panes">
      <aside className="chat-pane" aria-label="会話一覧"><div className="pane-heading"><div><h1>会話</h1><p>{chats.length}件表示・最大{MAX}件</p></div><button className="icon-button" onClick={() => void loadChats()} disabled={chatsBusy} aria-label="会話一覧を更新">↻</button></div>{chatError && <ErrorBar text={chatError} retry={loadChats} />}{chatsBusy && chats.length === 0 ? <Empty text="会話を読み込んでいます…" /> : chats.length === 0 ? <Empty text="表示できる会話はありません" /> : <ul className="chat-list">{chats.map(chat => <li key={chat.id}><button className={selected?.id === chat.id ? 'chat active' : 'chat'} onClick={() => choose(chat)}><span className="chat-top"><strong>{chat.name || '名前のない会話'}{chat.trimmed && <span className="trim">（省略）</span>}</strong><time>{dateLabel(chat.lastMessageAt)}</time></span><span className="chat-meta">{chat.service || 'サービス不明'}{chat.isGroup === true ? '・グループ' : chat.isGroup === null ? '・グループ判定不明' : ''}{chat.unreadCount === null ? '・未読数不明' : chat.unreadCount > 0 ? `・未読 ${chat.unreadCount}` : ''}</span></button></li>)}</ul>}<LoadMore value={chatLimit} busy={chatsBusy} onMore={() => setChatLimit(value => Math.min(MAX, value + PAGE))} /></aside>
      <main className="detail-pane">{!selected ? <Empty text="会話を選択するとメッセージが表示されます" /> : <><div className="pane-heading detail-heading"><button className="back" onClick={() => { selectedId.current = null; setSelected(null); setMessages([]); }} aria-label="会話一覧へ戻る">←</button><div><h1>{selected.name || '名前のない会話'}</h1><p>{messages.length}件表示・最大{MAX}件</p></div><button className="icon-button" onClick={() => void loadHistory()} disabled={historyBusy} aria-label="メッセージを更新">↻</button></div>{historyError && <ErrorBar text={historyError} retry={loadHistory} />}<div className="message-area" aria-live="polite">{historyBusy && messages.length === 0 ? <Empty text="メッセージを読み込んでいます…" /> : messages.length === 0 ? <Empty text="メッセージはありません" /> : <ol className="messages">{messages.map(message => <li key={message.id} className={message.isFromMe ? 'mine' : 'theirs'}><div className="bubble">{selected.isGroup === true && message.sender && <span className="sender">{message.sender}</span>}{message.attachments.map((item, i) => <Attachment key={item.id ?? `none-${i}`} item={item} />)}{(message.text || (message.attachments.length === 0 && !message.link)) && <p>{message.text || '本文のないメッセージ'}{message.trimmed && <span className="trim">（省略）</span>}</p>}{message.link && <LinkCard link={message.link} />}<time>{dateLabel(message.createdAt)}</time></div></li>)}</ol>}</div><LoadMore value={messageLimit} busy={historyBusy} onMore={() => setMessageLimit(value => Math.min(MAX, value + PAGE))} />{sendMode && <Composer chat={selected} mode={sendMode} send={sendMessage} upload={uploadFile} onSent={() => void loadHistory()} onAuthError={loseSession} />}</>}</main>
    </div>
  </div>;
}

function Empty({ text }: { text: string }) { return <div className="empty" role="status">{text}</div>; }
function ErrorBar({ text, retry }: { text: string; retry: () => Promise<void> }) { return <div className="error-bar" role="alert"><span>{text}</span><button className="secondary compact" onClick={() => void retry()}>再試行</button></div>; }
function LoadMore({ value, busy, onMore }: { value: number; busy: boolean; onMore: () => void }) { return value < MAX ? <div className="load-more"><button className="secondary" disabled={busy} onClick={onMore}>さらに50件読み込む</button><span>取得上限 {value}/{MAX}</span></div> : <p className="limit">表示上限の{MAX}件です</p>; }
