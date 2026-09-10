import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('所有者キー').fill('A'.repeat(43));
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: /合成テスト会話 Alpha/ })).toBeVisible();
}
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
test('B05 mobile360/dark/keyboard and long synthetic content does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ colorScheme: 'dark' });
  await login(page);
  await page.route('**/messages?*', route => route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: '長文😀'.repeat(2000), isFromMe: false, createdAt: null, trimmed: true }] } }));
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
    void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'LATE_PRIVATE_SENTINEL', isFromMe: false, createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); });
  });
  await page.getByRole('button', { name: /合成テスト会話 Alpha/ }).click(); await gate;
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click(); await complete();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled();
  await expect(page.getByText('LATE_PRIVATE_SENTINEL')).toHaveCount(0);
});
test('B05 old selected chat response cannot replace the newly selected chat', async ({ page }) => {
  await login(page); let complete!: () => Promise<void>;
  const entered = new Promise<void>(resolve => { void page.route(`**/${'C'.repeat(43)}/messages?*`, route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_CHAT_SENTINEL', isFromMe: false, createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
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
  let complete!: () => Promise<void>; const entered = new Promise<void>(resolve => { void page.route('**/messages?*', route => { complete = async () => { await route.fulfill({ json: { epoch: 'epoch-a', limit: 50, messages: [{ id: 'X', text: 'OLD_EPOCH_SENTINEL', isFromMe: false, createdAt: null, trimmed: false }] } }).catch(() => {}); }; resolve(); }); });
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
