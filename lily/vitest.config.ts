import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// テストは実際の workerd 上で動かす。D1 の CHECK / STRICT / 部分ユニーク索引が
// 効いていることまで見たいので、SQLite を別実装で代用しない。
//
// migrations/ を読んでバインディング経由でテスト側へ渡し、setup で各テストの
// D1 に適用する。スキーマの正は migrations/*.sql の 1 箇所だけ。
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
