import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests', fullyParallel: false, workers: 1, timeout: 30_000,
  use: { baseURL: 'https://127.0.0.1:19443', ignoreHTTPSErrors: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
      // A microphone that is always there and always allowed, so recording can be tested without a
      // person to grant it. It plays a tone; no real device is opened.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }, trace: 'off', screenshot: 'only-on-failure' },
  webServer: { command: 'node browser-tests/fixture.mjs', url: 'https://127.0.0.1:19443/health', ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 15_000 },
});
