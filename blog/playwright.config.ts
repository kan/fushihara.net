import { defineConfig, devices } from '@playwright/test';
import { ORIGIN, PORT } from './e2e/helpers.ts';
import { MOUNT_PATH } from './src/site/meta.ts';

/**
 * **D1 と R2 を dev と分ける。** 既定の `.wrangler/state` を使うと、E2E が
 * 手元の記事を消してフィクスチャで上書きしてしまう。`--persist-to` で別の
 * ディレクトリに逃がし、毎回捨ててから作り直す。
 */
const PERSIST = '.wrangler/e2e';

export default defineConfig({
  testDir: './e2e',
  // wrangler dev に対して回す。末尾スラッシュの補完も 404 の解決も Workers の
  // 配信側の挙動なので、別のサーバー相手にテストしても本番を検証したことにならない。
  //
  // reuseExistingServer は使わない。wrangler dev は dist をそのまま配るだけで
  // 再ビルドしないので、居残ったサーバーを再利用すると古い成果物に対してテストが
  // 通ってしまい、変更が検証されない。
  webServer: {
    command: [
      // 前回の記事が残っていると public_id が衝突して seed が落ちる。毎回捨てる。
      `rm -rf ${PERSIST}`,
      `npx wrangler d1 migrations apply DB --local --persist-to ${PERSIST} -c ./wrangler.jsonc`,
      'npm run build',
      `npx wrangler dev -c ./wrangler.jsonc --port ${PORT} --persist-to ${PERSIST}`,
    ].join(' && '),
    url: `${ORIGIN}${MOUNT_PATH}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: { baseURL: ORIGIN, trace: 'on-first-retry' },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  projects: [
    // フィクスチャの取り込み。**サーバーが起きてからでないとできない**ので、
    // globalSetup ではなく依存関係のあるプロジェクトにしてある。
    { name: 'seed', testMatch: /seed\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['seed'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      dependencies: ['seed'],
    },
  ],
});
