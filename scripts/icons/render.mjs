// apple-touch-icon.png（180×180）を apple-touch-icon.svg から作り直す: node scripts/icons/render.mjs
// Playwright の Chromium で描く（リポジトリの試験に使っているもの）。出力は web/public/ へ
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const svg = await readFile(`${here}apple-touch-icon.svg`, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:180px;height:180px}</style>${svg}`);
  await page.screenshot({ path: `${here}../../web/public/apple-touch-icon.png`, omitBackground: false });
} finally {
  await browser.close();
}
