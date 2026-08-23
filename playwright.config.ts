import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // 描画の検証なので、開発サーバではなく本番と同じビルド成果物に対して回す。
  // reuseExistingServer は使わない。preview はビルド済みスナップショットを配信する
  // だけで再ビルドしないため、居残ったサーバーを再利用すると古い成果物に対して
  // テストが通ってしまい、変更が検証されない。
  webServer: {
    command: 'npm run preview',
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
