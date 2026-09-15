import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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
// There is no refresh button: returning to the tab is what asks for fresh data.
const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
/**
 * The server allows 20 logins a minute and 16 sessions at once, and both of those limits are
 * worth keeping. So the suite logs in once and carries that session from test to test, making
 * a new one only when a test has deliberately ended the old one.
 */
let shared: Awaited<ReturnType<BrowserContext['cookies']>> | null = null;
/**
 * A session is also capped at 120 requests a minute, and the suite polls. Carrying one session
 * through every test crosses that; a handful of tests each is comfortably inside both limits.
 */
const TESTS_PER_SESSION = 6;
let used = 0;
const listed = (page: Page) => page.getByRole('button', { name: /合成テスト会話 Alpha/ });
async function login(page: Page) {
  if (used >= TESTS_PER_SESSION) { shared = null; used = 0; }
  used++;
  if (shared) {
    await page.context().addCookies(shared);
    await page.goto('/');
    // isVisible() answers immediately, before the list has been fetched; this waits for it.
    const stillIn = await listed(page).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    if (stillIn) return;
    shared = null; // the session was logged out or revoked by an earlier test
  }
  await page.goto('/'); await page.getByLabel('パスワード').fill('A'.repeat(43));
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(listed(page)).toBeVisible();
  shared = await page.context().cookies();
}
test('the sign-in screen offers a way back in: a link, then a screen of its own with copyable commands', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByLabel('パスワード')).toBeVisible();
  const link = page.getByRole('button', { name: 'パスワードを忘れた場合' });
  await expect(page.getByText('auth rotate')).toHaveCount(0); // nothing but the link, until asked
  await link.click();

  // The guide replaces the form rather than growing under it.
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた場合' })).toBeVisible();
  await expect(page.getByText('SSH経由では拒否されます')).toBeVisible();
  // Both commands in full, each saying what it does.
  const commands = page.locator('pre');
  await expect(commands).toHaveCount(2);
  await expect(commands.nth(0)).toHaveText('"$HOME/Library/Application Support/imsg-web/imsg-web" auth rotate');
  await expect(commands.nth(1)).toHaveText('"$HOME/Library/Application Support/imsg-web/imsg-web" auth set-password');
  await expect(page.getByText('ランダムな43文字のキー', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: /2\. 新しいパスワードを決めるのコマンドをコピー/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe('"$HOME/Library/Application Support/imsg-web/imsg-web" auth set-password');

  // Back to signing in, with nothing typed carried over.
  await page.getByRole('button', { name: 'ログイン画面へ戻る' }).click();
  await expect(page.getByLabel('パスワード')).toBeVisible();
  await expect(page.getByText('auth rotate')).toHaveCount(0);

  // It stays inside the card at a phone's width.
  await page.setViewportSize({ width: 360, height: 900 });
  await link.click();
  const card = await page.locator('.login-card').boundingBox();
  const block = await page.locator('pre').first().boundingBox();
  expect(block!.x).toBeGreaterThanOrEqual(card!.x);
  expect(block!.x + block!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
});

test('says nothing about features it does not offer, and admits when it could not ask', async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { epoch: 'epoch-a', mode: 'readonly', features: {
    chats: { state: 'available', reasonCode: 'SUPPORTED' },
    read: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
    typing: { state: 'unknown', reasonCode: 'STATUS_PROBE_DISABLED' },
  } } }));
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  // Read-state and typing are not offered, so nothing is said about them or about why.
  await expect(page.getByText(/SIP|許可|権限|既読|入力中|機能/)).toHaveCount(0);
  await expect(page.getByLabel('メッセージを入力')).toHaveCount(0); // send absent: no composer
  // But a read that never succeeded is not the same as a feature being off.
  await page.unroute('**/api/capabilities');
  await page.route('**/api/capabilities', route => route.fulfill({ status: 503, json: { code: 'READ_UNAVAILABLE' } }));
  await page.reload();
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('送信できるか確認できていません。')).toBeVisible();
});
test('B01/B05 HTTPS cookie, synthetic reading, text-only rendering and no durable private state', async ({ page, context }) => {
  await login(page);
  const cookies = await context.cookies(); const cookie = cookies.find(c => c.name === '__Host-imsg_session')!;
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie.value);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await expect(page.locator('.bubble img, .bubble a')).toHaveCount(0);
  await expect(page.locator('.chat-preview').first()).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.screenshot({ path: 'test-results/synthetic-desktop.png', fullPage: true, animations: 'disabled' });
  // One owner, one account: there is no bar across the top and nothing to sign out of.
  await expect(page.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
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

test('a conversation row carries the newest message, and its unread count as a badge', async ({ page }) => {
  await login(page);
  const beta = page.locator('.chat-list li', { hasText: '合成テスト会話 Beta' });
  await expect(beta.locator('.chat-preview')).toHaveText('一覧に出る合成プレビュー…');
  await expect(beta.getByLabel('未読 2')).toHaveText('2');
  // The owner's own last word is marked as theirs, and a read conversation carries no badge.
  const alpha = page.locator('.chat-list li', { hasText: '合成テスト会話 Alpha' });
  await expect(alpha.locator('.chat-preview')).toHaveText('自分: 送信済みの合成メッセージです。');
  await expect(alpha.getByLabel(/未読/)).toHaveCount(0);
  // A conversation whose newest message has not been read leaves the line blank rather than
  // claiming there is nothing there.
  await expect(page.locator('.chat-list li', { hasText: '合成長尺 Sigma' }).locator('.chat-preview')).toHaveText('\u00a0');
});

test('puts the sender’s face at the foot of their run in a group, and nowhere else', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成グループ Gamma/ }).click();
  await expect(page.getByText('返信の合成本文')).toBeVisible();
  const rows = page.locator('.messages > li');
  // Delta speaks three times, then Epsilon once: one face at the end of Delta's run, one for Epsilon.
  await expect(rows.nth(0).locator('.chat-avatar')).toHaveCount(0);
  await expect(rows.nth(1).locator('.chat-avatar')).toHaveCount(0);
  await expect(rows.nth(2).locator('img.chat-avatar')).toHaveAttribute('src', /\/api\/avatars\//);
  await expect(rows.nth(3).locator('span.chat-avatar')).toHaveText('合E'); // no picture: initials
  // It sits at the foot of the bubble, not beside its top.
  const face = await rows.nth(2).locator('.chat-avatar').boundingBox();
  const bubble = await rows.nth(2).locator('.bubble').boundingBox();
  expect(face!.x).toBeLessThan(bubble!.x);
  expect(Math.abs((face!.y + face!.height) - (bubble!.y + bubble!.height))).toBeLessThan(2);

  // A one-to-one conversation keeps its bubbles unadorned.
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  await expect(page.locator('.messages .chat-avatar')).toHaveCount(0);
});

test('shows a contact picture where the address book has one, initials where it does not', async ({ page }) => {
  await login(page);
  const row = (name: string) => page.locator('.chat-list li', { hasText: name });
  const picture = row('合成テスト会話 Alpha').locator('img.chat-avatar');
  await expect(picture).toHaveAttribute('src', /\/api\/avatars\//);
  await expect.poll(() => picture.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(64);
  // No picture: the initials stand in, and they are decoration rather than something to read out.
  const initials = row('合成テスト会話 Beta').locator('span.chat-avatar');
  await expect(initials).toHaveText('合B');
  await expect(initials).toHaveAttribute('aria-hidden', 'true');
  // Every conversation has one or the other.
  await expect(page.locator('.chat-list li .chat-avatar')).toHaveCount(await page.locator('.chat-list li').count());
});

test('colours a sent message by the service it went out over', async ({ page }) => {
  await login(page);
  const sent = page.locator('.bubble', { hasText: '送信済みの合成メッセージです。' });
  const colour = () => sent.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); // iMessage
  await expect(sent).toHaveClass(/sent-imessage/);
  const blue = await colour();
  await page.getByRole('button', { name: /合成テスト会話 Beta/ }).click(); // SMS
  await expect(sent).toHaveClass(/sent-other/);
  expect(await colour()).not.toBe(blue);
  // Only what was sent is coloured; what came in is not.
  await expect(page.locator('.bubble', { hasText: 'Beta の合成本文' })).not.toHaveClass(/sent-/);
});

test('pulls a run of messages together and gives room where the speaker changes', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成長尺 Sigma/ }).click();
  await expect(page.locator('.messages > li')).toHaveCount(50);
  const gap = async (upper: string, lower: string) => {
    const a = (await page.getByText(upper, { exact: true }).boundingBox())!;
    const b = (await page.getByText(lower, { exact: true }).boundingBox())!;
    return b.y - (a.y + a.height);
  };
  // Every third message is the owner's: #2→#1 is one person still talking, #3→#2 is a change.
  const run = await gap('合成メッセージ #2', '合成メッセージ #1');
  const change = await gap('合成メッセージ #3', '合成メッセージ #2');
  expect(change).toBeGreaterThan(run + 12);

  // In a group, the name is written once at the top of a run rather than over every bubble.
  await page.getByRole('button', { name: /合成グループ Gamma/ }).click();
  await expect(page.getByText('返信の合成本文')).toBeVisible();
  // Three from one sender then one from another: a name at the head of each run, not on each bubble.
  await expect(page.locator('.messages > li')).toHaveCount(4);
  await expect(page.locator('.bubble .sender')).toHaveCount(2);
});

test('opens a conversation at its newest message, and follows the newest as more arrive', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成長尺 Sigma/ }).click();
  await expect(page.locator('.messages > li')).toHaveCount(50);
  // #1 is the newest and sits last. The view starts on it, not on the oldest.
  await expect(page.getByText('合成メッセージ #1', { exact: true })).toBeInViewport();
  await expect(page.getByText('合成メッセージ #50', { exact: true })).not.toBeInViewport();
  const { top, height, view } = await metrics(page);
  expect(height).toBeGreaterThan(view); // the list really does scroll
  expect(height - top - view).toBeLessThanOrEqual(48);
  // A conversation with nothing older says so rather than asking for a page that is not there:
  // two messages came back where 50 were asked for.
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.locator('.messages > li')).toHaveCount(2);
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
  await expect(page.locator('.messages > li')).toHaveCount(50);
  // The field names the service it will send over, as Messages does, and nothing else.
  await expect(page.getByLabel('メッセージを入力')).toHaveAttribute('placeholder', 'iMessage');
  await settle(page);
  await expect(page.getByText('合成メッセージ #1', { exact: true })).toBeInViewport();
  const { top, height, view } = await metrics(page);
  expect(height - top - view).toBeLessThanOrEqual(2); // the bottom, not slightly above it
});

test('scrolling to the top loads the previous page and leaves the view where it was', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成長尺 Sigma/ }).click();
  await expect(page.locator('.messages > li')).toHaveCount(50);
  const oldest = page.getByText('合成メッセージ #50', { exact: true });
  await area(page).evaluate(el => { el.scrollTop = 0; });
  // No button was pressed: reaching the top is the request.
  await expect(page.locator('.messages > li')).toHaveCount(100);
  await expect(page.getByText('合成メッセージ #100', { exact: true })).toBeVisible();
  // The message that was at the top is still there, still at the top of the view.
  await expect(oldest).toBeInViewport();
  const box = await oldest.boundingBox(), frame = await area(page).boundingBox();
  expect(box!.y - frame!.y).toBeLessThan(260);
  // Landing at the top again pages back again, and the count is honest about it.
  await area(page).evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.messages > li')).toHaveCount(150);
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
test('keeps the composer on one line, the field and both round buttons the same height', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByLabel('メッセージを入力')).toBeVisible();
  const box = async (name: string) => (await page.getByLabel(name).boundingBox())!;
  // An SMS conversation says so instead; the placeholder never wraps the field onto a second line.
  await page.getByRole('button', { name: /合成テスト会話 Beta/ }).click();
  await expect(page.getByLabel('メッセージを入力')).toHaveAttribute('placeholder', 'SMS');
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click();
  await expect(page.getByLabel('メッセージを入力')).toHaveAttribute('placeholder', 'iMessage');
  const [add, field, send] = [await box('添付ファイルを追加'), await box('メッセージを入力'), await box('送信')];
  expect([add!.height, send!.height]).toEqual([field!.height, field!.height]);
  expect(add!.width).toBe(add!.height); // circular
  expect(send!.width).toBe(send!.height);
  // One row, in order, with the field between the two buttons.
  expect([add!.y, send!.y]).toEqual([field!.y, field!.y]);
  expect(add!.x).toBeLessThan(field!.x);
  expect(field!.x + field!.width).toBeLessThanOrEqual(send!.x);
  // Nothing to drag: the field grows with what is written, and stops growing eventually.
  await expect(page.getByLabel('メッセージを入力')).toHaveCSS('resize', 'none');
  await page.getByLabel('メッセージを入力').fill(['一行目', '二行目', '三行目'].join('\n'));
  await expect.poll(async () => (await box('メッセージを入力')).height).toBeGreaterThan(field!.height);
  await page.getByLabel('メッセージを入力').fill(Array.from({ length: 40 }, (_, i) => `行 ${i}`).join('\n'));
  await expect.poll(async () => (await box('メッセージを入力')).height).toBe(192);
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
  await expect(page.getByRole('button', { name: '写真 1.png を外す' })).toBeVisible();
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
  await expect(rows.nth(3).getByRole('button', { name: 'three.png を外す' })).toBeVisible();
  await rows.nth(3).getByRole('button', { name: /を外す$/ }).click();
  await expect(rows).toHaveCount(3);
  // Images preview from a local blob URL; a non-image gets a placeholder. Nothing is uploaded to draw them.
  const thumbs = page.locator('.composer-files img.composer-thumb');
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first()).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => thumbs.first().evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(page.locator('.composer-files .placeholder')).toHaveCount(1);
  expect(uploads).toEqual([]);
  // One can be removed before sending.
  await rows.nth(2).getByRole('button', { name: /を外す$/ }).click();
  await expect(rows).toHaveCount(2);
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
test('B02 a read that lands after the session ends cannot restore private data', async ({ page }) => {
  await login(page);
  let complete!: () => Promise<void>; const gate = new Promise<void>(resolve => {
    void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'LATE_PRIVATE_SENTINEL', isFromMe: false, sender: null, avatarId: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); });
  });
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await gate;
  // The session expires while that read is still out.
  await page.route('**/api/chats?*', route => route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } }));
  await refresh(page);
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled();
  await complete();
  await expect(page.getByText('LATE_PRIVATE_SENTINEL')).toHaveCount(0);
});
test('B05 old selected chat response cannot replace the newly selected chat', async ({ page }) => {
  await login(page); let complete!: () => Promise<void>;
  const entered = new Promise<void>(resolve => { void page.route(`**/${'C'.repeat(43)}/messages?*`, route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_CHAT_SENTINEL', isFromMe: false, sender: null, avatarId: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await entered;
  await page.getByRole('button', { name: /合成テスト会話 Beta/ }).click();
  await expect(page.getByText('Beta の合成本文')).toBeVisible(); await complete();
  await expect(page.getByText('OLD_CHAT_SENTINEL')).toHaveCount(0); await expect(page.getByText('Beta の合成本文')).toBeVisible();
});
test('B05 empty/error states, a pane too tall for one page, and the 1000-row ceiling', async ({ page }) => {
  const limits: number[] = [];
  let full = false; // start empty, then answer with as many conversations as were asked for
  await page.route('**/api/chats?*', route => {
    const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
    limits.push(limit);
    const chats = full ? Array.from({ length: limit }, (_, i) => ({ id: `C${String(i).padStart(42, '0')}`, name: `合成会話 ${i}`, service: 'iMessage', isGroup: null, unreadCount: null, lastMessageAt: null, trimmed: false, preview: null, avatarId: null })) : [];
    return route.fulfill({ json: { epoch: 'epoch-a', limit, chats } });
  });
  await page.goto('/'); await page.getByLabel('パスワード').fill('A'.repeat(43)); await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByText('表示できる会話はありません')).toBeVisible();
  expect(limits.every(limit => limit === 50)).toBe(true); // an empty list never asks for a second page
  // A pane taller than one page of conversations cannot be scrolled, and scrolling is what asks
  // for the next page. It fills itself instead rather than sitting there half empty.
  await page.setViewportSize({ width: 1280, height: 6000 });
  full = true; await refresh(page);
  const rows = page.locator('.chat-list li');
  const area = page.locator('.chat-area');
  await expect.poll(() => area.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await rows.count()).toBeGreaterThan(50);
  await page.setViewportSize({ width: 1280, height: 720 });
  // No button: reaching the end of the list is the request, and it stops at the ceiling.
  for (let count = await rows.count(); count < 1000; count += 50) {
    await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(rows).toHaveCount(count + 50);
  }
  await expect(page.getByText('表示上限の1000件です')).toBeVisible();
  await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => limits.at(-1)).toBe(1000);
  expect(limits).toContain(50); expect(limits.every(limit => limit >= 50 && limit <= 1000 && limit % 50 === 0)).toBe(true);
  await page.unroute('**/api/chats?*'); await page.route('**/api/chats?*', route => route.fulfill({ status: 503, json: { code: 'READ_UNAVAILABLE' } }));
  await refresh(page); await expect(page.getByRole('alert')).toContainText('更新できていません');
});
test('B05 epoch change clears all resources; delayed old epoch cannot restore them', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await expect(page.getByText('Alpha の合成本文', { exact: false })).toBeVisible();
  // One read cycle where the conversation list has moved to a new database generation while the
  // message read is still out: it answers for the old one, long after the switch.
  let complete!: () => Promise<void>; const entered = new Promise<void>(resolve => { void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_EPOCH_SENTINEL', isFromMe: false, sender: null, avatarId: null, attachments: [], link: null, replyTo: null, reactions: [], createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
  await page.route('**/api/chats?*', route => route.fulfill({ json: { epoch: 'epoch-b', limit: 50, chats: [] } }));
  await page.route('**/api/capabilities', route => route.fulfill({ json: { epoch: 'epoch-b', mode: 'readonly', features: {} } }));
  await refresh(page); await entered;
  await expect(page.getByText('メッセージデータが更新されました。会話を選び直してください。')).toBeVisible(); await complete();
  await expect(page.getByText('OLD_EPOCH_SENTINEL')).toHaveCount(0); await expect(page.getByText('表示できる会話はありません')).toBeVisible();
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
  await refresh(page);
  await expect(page.getByLabel('パスワード')).toBeVisible();
  await expect(page.getByText('合成テスト会話 Alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Alpha の合成本文', { exact: false })).toHaveCount(0);
});
