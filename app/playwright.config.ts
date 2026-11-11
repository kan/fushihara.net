import { defineConfig, devices } from '@playwright/test';

/** 本体（4173）とブログ（8787 / 8788）と被らないポート */
const PORT = 8789;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // wrangler dev に対して回す。_headers の適用も末尾スラッシュの扱いも Workers の
  // 配信側の挙動なので、別のサーバー相手では本番を検証したことにならない。
  //
  // reuseExistingServer は使わない。wrangler dev は dist をそのまま配るだけで
  // 再ビルドしないので、居残ったサーバーを再利用すると古い成果物に対してテストが
  // 通ってしまい、変更が検証されない。
  webServer: {
    command: `npm run serve -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL, trace: 'on-first-retry' },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
