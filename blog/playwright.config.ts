import { defineConfig, devices } from '@playwright/test';

// astro dev の既定ポート (4321) を避ける。reuseExistingServer: false なので
// 同じにすると dev サーバーを開いたままテストを回せない。
const PORT = 4322;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // astro preview ではなく wrangler dev を使う。本番と同じ Workers のアセット配信
  // (末尾スラッシュの補完 / 404.html の解決) まで含めて検証したいため。
  // 明示的な -c が要るのは、親ディレクトリの .wrangler/deploy/config.json を拾って
  // 「どちらの設定か分からない」と落ちるのを避けるため。
  //
  // reuseExistingServer は使わない。wrangler dev は dist をそのまま配るだけで
  // 再ビルドしないので、居残ったサーバーを再利用すると古い成果物に対してテストが
  // 通ってしまい、変更が検証されない。
  webServer: {
    // 記事ではなく test-content/ のフィクスチャに対して回す。実記事に依存させると、
    // 記事を書き換えるたびにテストが落ちる (blog/test-content/README.md 参照)。
    command: `BLOG_CONTENT_DIR=./test-content/posts npm run build && npx wrangler dev -c ./wrangler.jsonc --port ${PORT}`,
    url: `${baseURL}/blog/`,
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
