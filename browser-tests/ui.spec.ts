import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// Real files on disk, so re-picking one keeps its identity (name, size, lastModified) as it would for the owner.
const scratch = mkdtempSync(join(tmpdir(), 'iw-attach-'));
const onDisk = (name: string, body: Buffer) => { const path = join(scratch, name); writeFileSync(path, body); return path; };
const FILE_ONE = onDisk('one.png', PNG);
const FILE_TWO = onDisk('two.png', PNG);
const FILE_THREE = onDisk('three.png', PNG);
const FILE_NOTES = onDisk('notes.txt', Buffer.from('synthetic'));
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('所有者キー').fill('A'.repeat(43));
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: /合成テスト会話 Alpha/ })).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const logout = page.getByRole('button', { name: 'ログアウト' });
  if (!await logout.isVisible().catch(() => false)) return;
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/session') && r.request().method() === 'DELETE').catch(() => {}),
    logout.click().catch(() => {}),
  ]);
});
test('explains disabled advanced discovery without claiming SIP or permission state', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { epoch: 'epoch-a', mode: 'readonly', features: {
    chats: { state: 'available', reasonCode: 'SUPPORTED' },
    read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
    typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
  } } }));
  await login(page);
  await expect(page.getByRole('status').filter({ hasText: '既読・入力中の機能状態' })).toHaveText('既読・入力中の機能状態は未確認です。安全に確認する機能はまだ実装されていません。');
});
test('B01/B05 HTTPS cookie, synthetic reading, text-only rendering, logout and no durable private state', async ({ page, context }) => {
  await login(page);
  const cookies = await context.cookies(); const cookie = cookies.find(c => c.name === '__Host-imsg_session')!;
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie.value);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await expect(page.locator('.bubble img, .bubble a')).toHaveCount(0);
  await expect(page.getByText('未読数不明', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.screenshot({ path: 'test-results/synthetic-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled();
  await expect(page.getByLabel('所有者キー')).toHaveValue('');
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toHaveCount(0);
  expect((await page.request.get('/api/chats')).status()).toBe(401);
});
test('names senders only in group chats; shows images it can, and says why for the rest', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await expect(page.getByText('合成送信者 Hidden')).toHaveCount(0);
  await page.getByRole('button', { name: /合成グループ Gamma/ }).click();
  await expect(page.getByText('合成送信者 Delta').first()).toBeVisible();
  const card = page.locator('a.link-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('href', 'https://example.invalid/synthetic-article');
  await expect(card).toHaveAttribute('target', '_blank');
  await expect(card).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(card).toContainText('合成リンクのタイトル');
  await expect(card).toContainText('合成サイト · example.invalid');
  await expect(page.getByText('危険なリンクの合成本文')).toBeVisible();
  await expect(page.getByText('開いてはいけない合成リンク')).toHaveCount(0);
  const image = page.locator('.bubble > img.attachment-image');
  await expect(image).toHaveCount(1);
  const thumbnail = page.locator('figure.attachment-preview');
  await expect(thumbnail.locator('img')).toHaveAttribute('src', `/api/attachments/${'T'.repeat(43)}`);
  await expect(thumbnail).toContainText('サムネイル（元の画像はこのMacにありません）');
  await expect(image).toHaveAttribute('src', `/api/attachments/${'P'.repeat(43)}`);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(page.getByText('画像（このブラウザでは表示できない形式です）')).toBeVisible();
  await expect(page.getByText('画像（このMacに保存されていないか、表示できない形式です）')).toBeVisible();
  await expect(page.getByText('動画（この画面では表示できません）')).toBeVisible();
  await expect(page.getByText('本文のないメッセージ')).toHaveCount(0);
});
test('shows what a message replies to, and the tapbacks on it', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成グループ Gamma/ }).click();
  await expect(page.getByText('返信の合成本文')).toBeVisible();
  const replied = page.locator('.bubble', { hasText: '返信の合成本文' });
  const quote = replied.locator('.reply-quote');
  await expect(quote).toContainText('合成送信者 Epsilon');
  await expect(quote).toContainText('元になった合成メッセージ');
  await expect(quote).toContainText('（省略）');
  const reactions = replied.locator('.reactions li');
  await expect(reactions).toHaveCount(2);
  await expect(reactions.first()).toContainText('❤️');
  await expect(reactions.first()).toContainText('3'); // identical tapbacks collapse into a count
  await expect(reactions.first()).toHaveAttribute('title', '合成送信者 Alpha、合成送信者 Beta、自分');
  await expect(reactions.nth(1)).toContainText('👍');
  // A message with neither shows neither.
  const plain = page.locator('.bubble', { hasText: '危険なリンクの合成本文' });
  await expect(plain.locator('.reply-quote, .reactions')).toHaveCount(0);
});
const area = (page: Page) => page.locator('.message-area');
const metrics = (page: Page) => area(page).evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight }));

test('opens a conversation at its newest message, and follows the newest as more arrive', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成長尺 Sigma/ }).click();
  await expect(page.locator('.messages li')).toHaveCount(50);
  // #1 is the newest and sits last. The view starts on it, not on the oldest.
  await expect(page.getByText('合成メッセージ #1', { exact: true })).toBeInViewport();
  await expect(page.getByText('合成メッセージ #50', { exact: true })).not.toBeInViewport();
  const { top, height, view } = await metrics(page);
  expect(height).toBeGreaterThan(view); // the list really does scroll
  expect(height - top - view).toBeLessThanOrEqual(48);
  // A conversation with nothing older says so rather than asking for a page that is not there:
  // two messages came back where 50 were asked for.
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.locator('.messages li')).toHaveCount(2);
  await expect(page.getByText('これより前のメッセージはありません')).toBeVisible();
  await expect(page.getByRole('button', { name: '以前のメッセージを読み込む' })).toHaveCount(0);
});

// Waits until the list stops growing: images decode at their own pace, each one resizing
// the message it belongs to after that message was already laid out.
const settle = (page: Page) => page.waitForFunction(() => {
  const el = document.querySelector('.message-area');
  const state = window as unknown as { lastHeight?: number; stable?: number };
  if (!el) return false;
  if (state.lastHeight === el.scrollHeight) state.stable = (state.stable ?? 0) + 1;
  else { state.lastHeight = el.scrollHeight; state.stable = 0; }
  return (state.stable ?? 0) >= 5;
}, null, { polling: 100 });

test('stays at the newest message while images load in after the conversation is drawn', async ({ page }) => {
  // Images arrive late and out of order, each growing its message after it was laid out.
  await page.route('**/api/attachments/*', async route => {
    await new Promise(resolve => setTimeout(resolve, 40 + Math.floor(Math.random() * 120)));
    return route.continue();
  });
  // And the composer appears once capabilities land, taking height away from the list below it.
  await page.route('**/api/capabilities', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return route.fulfill({ json: { epoch: 'epoch-a', mode: 'readonly', features: {
      chats: { state: 'available', reasonCode: 'SUPPORTED' }, history: { state: 'available', reasonCode: 'SUPPORTED' },
      send: { state: 'available', reasonCode: 'SEND_READY' } } } });
  });
  await login(page);
  await page.getByRole('button', { name: /合成画像列 Vega/ }).click();
  await expect(page.locator('.messages li')).toHaveCount(50);
  await expect(page.getByPlaceholder('メッセージを入力', { exact: false })).toBeVisible();
  await settle(page);
  await expect(page.getByText('合成メッセージ #1', { exact: true })).toBeInViewport();
  const { top, height, view } = await metrics(page);
  expect(height - top - view).toBeLessThanOrEqual(2); // the bottom, not slightly above it
});

test('scrolling to the top loads the previous page and leaves the view where it was', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成長尺 Sigma/ }).click();
  await expect(page.locator('.messages li')).toHaveCount(50);
  const oldest = page.getByText('合成メッセージ #50', { exact: true });
  await area(page).evaluate(el => { el.scrollTop = 0; });
  // No button was pressed: reaching the top is the request.
  await expect(page.locator('.messages li')).toHaveCount(100);
  await expect(page.getByText('合成メッセージ #100', { exact: true })).toBeVisible();
  // The message that was at the top is still there, still at the top of the view.
  await expect(oldest).toBeInViewport();
  const box = await oldest.boundingBox(), frame = await area(page).boundingBox();
  expect(box!.y - frame!.y).toBeLessThan(260);
  // Landing at the top again pages back again, and the count is honest about it.
  await area(page).evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.messages li')).toHaveCount(150);
  await expect(page.getByText('150件表示・最大1000件')).toBeVisible();
});

test('sends on click or Ctrl+Enter, with no confirmation step, and is honest about each outcome', async ({ page }) => {
  const sends: { chatId: string; text: string }[] = [];
  await page.route('**/api/send', async route => { sends.push(route.request().postDataJSON()); await route.continue(); });
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  const box = page.getByLabel('メッセージを入力');
  await box.fill('合成の送信メッセージ');
  // Typing alone must not send.
  expect(sends).toEqual([]);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByText('送信しました。')).toBeVisible();
  expect(sends).toEqual([{ chatId: 'C'.repeat(43), text: '合成の送信メッセージ' }]);
  await expect(box).toHaveValue('');
  // Ctrl+Enter sends too; a plain Enter only adds a newline.
  await box.fill('キーボードからの送信');
  await box.press('Enter');
  expect(sends).toHaveLength(1);
  await box.press('Control+Enter');
  await expect(page.getByText('送信しました。')).toBeVisible();
  expect(sends).toHaveLength(2);
  expect(sends[1]).toMatchObject({ chatId: 'C'.repeat(43) });
  await expect(box).toHaveValue('');
  // An ambiguous result keeps the text and warns, without silently resending.
  await box.fill('UNKNOWN な送信');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByText('送信できたか不明です。', { exact: false })).toBeVisible();
  await expect(box).toHaveValue('UNKNOWN な送信');
  // A failure imsg marks as not-started keeps the text and says nothing was sent.
  await box.fill('FAIL な送信');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByText('送信されていません', { exact: false })).toBeVisible();
  await expect(box).toHaveValue('FAIL な送信');
});
test('attaches a file: uploads the raw bytes first, names it in the confirm, then sends by id', async ({ page }) => {
  const uploads: { url: string; type: string | undefined; bytes: number }[] = [];
  const sends: Record<string, unknown>[] = [];
  await page.route('**/api/uploads*', async route => {
    const request = route.request();
    uploads.push({ url: request.url(), type: request.headers()['content-type'], bytes: (request.postDataBuffer() ?? Buffer.alloc(0)).length });
    await route.continue();
  });
  await page.route('**/api/send', async route => { sends.push(route.request().postDataJSON()); await route.continue(); });
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await page.getByLabel('添付ファイルを選ぶ').setInputFiles({ name: '写真 1.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-bytes') });
  await expect(page.locator('.composer-files li')).toHaveCount(1);
  await expect(page.getByText('写真 1.png', { exact: false })).toBeVisible();
  // Choosing a file must not upload or send anything yet.
  expect(uploads).toEqual([]);
  expect(sends).toEqual([]);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByText('送信しました。')).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.type).toBe('application/octet-stream'); // raw bytes, not multipart or base64
  expect(uploads[0]!.bytes).toBe('synthetic-image-bytes'.length);
  expect(decodeURIComponent(new URL(uploads[0]!.url).searchParams.get('name') ?? '')).toBe('写真 1.png');
  expect(sends).toEqual([{ chatId: 'C'.repeat(43), uploadIds: ['U'.repeat(43)] }]); // file only: no text, no path
  await expect(page.locator('.composer-files li')).toHaveCount(0);
});
test('previews each chosen file locally and sends several as several messages', async ({ page }) => {
  const uploads: string[] = [];
  const sends: Record<string, unknown>[] = [];
  await page.route('**/api/uploads*', async route => { uploads.push(route.request().url()); await route.continue(); });
  await page.route('**/api/send', async route => { sends.push(route.request().postDataJSON()); await route.continue(); });
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await page.getByLabel('添付ファイルを選ぶ').setInputFiles([FILE_ONE, FILE_TWO, FILE_NOTES]);
  const rows = page.locator('.composer-files li');
  await expect(rows).toHaveCount(3);
  // Picking again adds to the selection rather than replacing it, and ignores a file already chosen.
  await page.getByLabel('添付ファイルを選ぶ').setInputFiles([FILE_ONE, FILE_THREE]);
  await expect(rows).toHaveCount(4);
  await expect(page.getByText('three.png', { exact: false })).toBeVisible();
  await rows.nth(3).getByRole('button', { name: '外す' }).click();
  await expect(rows).toHaveCount(3);
  // Images preview from a local blob URL; a non-image gets a placeholder. Nothing is uploaded to draw them.
  const thumbs = page.locator('.composer-files img.composer-thumb');
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first()).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => thumbs.first().evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(page.locator('.composer-files .placeholder')).toHaveCount(1);
  expect(uploads).toEqual([]);
  // One can be removed before sending.
  await rows.nth(2).getByRole('button', { name: '外す' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('添付は1件ずつ別のメッセージとして送られます。')).toBeVisible();
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByText('2件すべて送信しました。')).toBeVisible();
  expect(uploads).toHaveLength(2); // one upload per file, before a single send call
  expect(sends).toEqual([{ chatId: 'C'.repeat(43), uploadIds: ['U'.repeat(43), 'U'.repeat(43)] }]);
  await expect(rows).toHaveCount(0);
});
test('B05 mobile360/dark/keyboard and long synthetic content does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ colorScheme: 'dark' });
  await login(page);
  await page.route('**/messages?*', route => route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: '長文😀'.repeat(2000), isFromMe: false, sender: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: true }] } }));
  const chat = page.getByRole('button', { name: /合成テスト会話 Alpha/ }); await chat.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('（省略）', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect.poll(async () => Math.round((await page.locator('.detail-pane').boundingBox())!.x)).toBe(0);
  expect(Math.round((await page.locator('.detail-pane').boundingBox())!.width)).toBe(360);
  await page.screenshot({ path: 'test-results/synthetic-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '会話一覧へ戻る' }).click(); await expect(chat).toBeVisible();
});
test('B02 delayed old read cannot restore private data after logout', async ({ page }) => {
  await login(page);
  let complete!: () => Promise<void>; const gate = new Promise<void>(resolve => {
    void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'LATE_PRIVATE_SENTINEL', isFromMe: false, sender: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); });
  });
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await gate;
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click(); await complete();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled();
  await expect(page.getByText('LATE_PRIVATE_SENTINEL')).toHaveCount(0);
});
test('B05 old selected chat response cannot replace the newly selected chat', async ({ page }) => {
  await login(page); let complete!: () => Promise<void>;
  const entered = new Promise<void>(resolve => { void page.route(`**/${'C'.repeat(43)}/messages?*`, route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_CHAT_SENTINEL', isFromMe: false, sender: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await entered;
  await page.getByRole('button', { name: /合成テスト会話 Beta/ }).click();
  await expect(page.getByText('Beta の合成本文')).toBeVisible(); await complete();
  await expect(page.getByText('OLD_CHAT_SENTINEL')).toHaveCount(0); await expect(page.getByText('Beta の合成本文')).toBeVisible();
});
test('B05 empty/error states and 1000-row request ceiling', async ({ page }) => {
  const limits: number[] = [];
  await page.route('**/api/chats?*', route => { const limit = Number(new URL(route.request().url()).searchParams.get('limit')); limits.push(limit); return route.fulfill({ json: { epoch: 'epoch-a', limit, chats: [] } }); });
  await page.goto('/'); await page.getByLabel('所有者キー').fill('A'.repeat(43)); await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByText('表示できる会話はありません')).toBeVisible();
  for (let i = 0; i < 19; i++) await page.getByRole('button', { name: 'さらに50件読み込む' }).click();
  await expect(page.getByText('表示上限の1000件です')).toBeVisible();
  await expect.poll(() => limits.at(-1)).toBe(1000);
  expect(limits).toContain(50); expect(limits.every(limit => limit >= 50 && limit <= 1000 && limit % 50 === 0)).toBe(true);
  await page.unroute('**/api/chats?*'); await page.route('**/api/chats?*', route => route.fulfill({ status: 503, json: { code: 'READ_UNAVAILABLE' } }));
  await page.getByRole('button', { name: '会話一覧を更新' }).click(); await expect(page.getByRole('alert')).toContainText('更新できていません');
});
test('B05 epoch change clears all resources; delayed old epoch cannot restore them', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  let complete!: () => Promise<void>; const entered = new Promise<void>(resolve => { void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_EPOCH_SENTINEL', isFromMe: false, sender: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
  await page.getByRole('button', { name: 'メッセージを更新' }).click(); await entered;
  await page.route('**/api/chats?*', route => route.fulfill({ json: { epoch: 'epoch-b', limit: 50, chats: [] } }));
  await page.getByRole('button', { name: '会話一覧を更新' }).click(); await expect(page.getByText('メッセージデータが更新されました。会話を選び直してください。')).toBeVisible(); await complete();
  await expect(page.getByText('OLD_EPOCH_SENTINEL')).toHaveCount(0); await expect(page.getByRole('button', { name: '会話一覧を更新' })).toBeEnabled();
});
test('B05 pauses polling while hidden and resumes one cycle without parallel reads', async ({ page }) => {
  await page.clock.install(); let count = 0, completed = 0, holdNext = false;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  page.on('response', response => { if (response.url().includes('/api/chats?')) void response.finished().then(() => { completed++; }); });
  await page.route('**/api/chats?*', async route => { count++; if (holdNext) await held; await route.continue(); });
  await login(page); await expect.poll(() => count).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(45_000); expect(count).toBe(1);
  holdNext = true;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => count).toBe(2);
  await page.clock.runFor(45_000); expect(count).toBe(2); // held response still unresolved, no next request
  holdNext = false; release();
  await expect.poll(() => completed).toBe(3); // one resume plus one coalesced pending focus refresh
  await page.clock.runFor(15_001); await expect.poll(() => count).toBe(4);
  await expect.poll(() => completed).toBe(4);
});
test('B02 401 clears rendered private metadata as well as message bodies', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await page.route('**/api/chats?*', route => route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } }));
  await page.getByRole('button', { name: '会話一覧を更新' }).click();
  await expect(page.getByLabel('所有者キー')).toBeVisible();
  await expect(page.getByText('合成テスト会話 Alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toHaveCount(0);
});
test('B02 failed logout gives revoke-all guidance without claiming the old session was revoked', async ({ page }) => {
  await login(page);
  await page.route('**/api/session', route => route.request().method() === 'DELETE' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('auth revoke-all');
  await expect(page.getByRole('alert')).toContainText('再ログインだけでは元のセッションは失効しません');
  expect((await page.request.get('/api/chats')).status()).toBe(200); // original cookie really survives the network failure
});
