// Takes the screenshots in the README, from the synthetic preview and nothing else. No real
// conversation is ever opened by this, and none could be: the server it drives is
// `demo-preview.mjs`, whose every message is made up in that file.
//
//   node scripts/screenshots.mjs          (after `npm run build`)
//
// Needs a Chromium: `npx playwright install chromium`, or CHROMIUM_PATH pointing at one.
//
// Each shot is framed as a browser window — a drawn one, not a real chrome — so the README shows
// the thing in the place it is actually used rather than as a bare rectangle.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from './demo-preview.mjs';

const out = new URL('../docs/screenshots/', import.meta.url);
const ADDRESS = 'your-mac.your-tailnet.ts.net';

/** The window drawn around a shot: a title bar, an address, and the page itself inside. */
const frame = (dataUrl, width, compact) => `<!doctype html><meta charset="utf-8"><style>
  :root { color-scheme: light }
  body { margin: 0; padding: ${compact ? 28 : 44}px; background: #eef2f7; font: 13px/1 -apple-system, "Helvetica Neue", sans-serif; }
  .window { width: ${width}px; margin: 0 auto; border-radius: ${compact ? 14 : 12}px; overflow: hidden;
    background: #fff; box-shadow: 0 24px 60px #16233d33, 0 2px 6px #16233d22; }
  .bar { display: flex; align-items: center; gap: 10px; padding: ${compact ? '8px 10px' : '10px 14px'};
    background: linear-gradient(#fbfcfe, #eef1f6); border-bottom: 1px solid #dde3ec; }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; }
  .address { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; justify-content: center;
    padding: 5px 12px; border-radius: 999px; background: #fff; border: 1px solid #dde3ec; color: #4a5768;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lock { width: 9px; height: 7px; border: 1.5px solid #6c7a8c; border-radius: 1px; position: relative; flex: none; }
  .lock::before { content: ''; position: absolute; left: 1.5px; top: -4px; width: 4px; height: 4px;
    border: 1.5px solid #6c7a8c; border-bottom: 0; border-radius: 2px 2px 0 0; }
  img { display: block; width: 100%; }
</style>
<div class="window">
  <div class="bar">
    <span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
    <span class="address"><span class="lock"></span>${ADDRESS}</span>
  </div>
  <img src="${dataUrl}">
</div>`;

async function main() {
  const server = await createDemoServer({ banner: false });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  await mkdir(out, { recursive: true });
  // The same escape hatch the test config has: a system Chromium where one is preferred, and
  // Playwright's own where CHROMIUM_PATH says nothing.
  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  const shoot = async ({ name, width, height, compact, prepare }) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.goto(base);
    await page.getByLabel('パスワード').fill('demo');
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('button', { name: /カフェの待ち合わせ/ }).waitFor();
    await prepare(page);
    await page.waitForTimeout(600);
    const shot = await page.screenshot();
    await page.close();

    // The page becomes the contents of a drawn window, and that is what is written out.
    const framed = await browser.newPage({ viewport: { width: width + 120, height: height + 200 }, deviceScaleFactor: 2 });
    await framed.setContent(frame(`data:image/png;base64,${shot.toString('base64')}`, width, compact));
    await framed.locator('.window').waitFor();
    const file = fileURLToPath(new URL(`${name}.png`, out));
    await framed.locator('body').screenshot({ path: file });
    await framed.close();
    console.log(`${name}.png`);
  };

  // Two between them cover the screen: the wide one has the list, faces, a voice message, a reply
  // and a tapback; the narrow one has a picture, the day breaks and the composer.
  await shoot({ name: 'group', width: 1120, height: 720, compact: false, prepare: async page => {
    await page.getByRole('button', { name: /週末のお出かけ/ }).click();
    await page.locator('.messages .voice').first().waitFor();
  } });
  await shoot({ name: 'phone', width: 420, height: 780, compact: true, prepare: async page => {
    await page.getByRole('button', { name: /カフェの待ち合わせ/ }).click();
    await page.locator('.messages .attachment-image').first().waitFor();
  } });

  await browser.close();
  server.close(); server.closeAllConnections();
}

await main();
