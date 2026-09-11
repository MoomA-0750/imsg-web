import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
// Run only against the synthetic preview, never against a production service.
const origin = process.argv[2];
if (!origin) throw new Error('Supply the synthetic preview HTTP origin');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(origin);
    await page.getByText('操作プレビュー · 架空データのみ／実送信なし', { exact: true }).waitFor();
    await page.getByLabel('所有者キー').fill('demo');
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('button', { name: /カフェの待ち合わせ/ }).click();
    await page.getByText('明日は駅前のカフェで待ち合わせにしませんか？ ☕', { exact: true }).first().waitFor();
    if (viewport.width < 600) await page.waitForFunction(() => getComputedStyle(document.querySelector('.detail-pane')).transform === 'matrix(1, 0, 0, 1, 0, 0)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/imsg-demo-${viewport.width}.png` });
    if (viewport.width < 600) {
      await page.getByRole('button', { name: '会話一覧へ戻る' }).click();
      await page.getByRole('button', { name: /空の会話/ }).click();
      await page.getByText('メッセージはありません', { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByLabel('所有者キー').waitFor();
    await page.close();
  }
  console.log('Synthetic preview desktop/mobile browser checks passed.');
} finally { await browser.close(); }
