import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

// **ここで見るのは fushihara.net の配線だけ。** CMS そのもの (ルーティング・
// フィード・管理 API・テーマの差し替え可能性) は lily 側のテストが見ている。
// こちらが確かめるのは「本番の設定が意図どおりに組まれているか」―― Access の
// 選ばれ方、cron の配線、公開ページに出る自前テーマ、共有の日付関数との一致。
//
// **スキーマの正は lily。** migrations も lily のパッケージから読む
// (`wrangler.jsonc` の `migrations_dir` と同じ場所を指す)。
const require = createRequire(import.meta.url);
const lily = dirname(require.resolve('@kanf/lily/package.json'));
const migrations = await readD1Migrations(join(lily, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // 名前の正は lily（`TEST_MIGRATIONS_BINDING`）。ずれたら
      // `applyTestMigrations()` が理由付きで落ちる。
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
    // 実 workerd の上で実 D1 を叩くので、既定の 5 秒では足りない (lily 側と同じ)。
    testTimeout: 30_000,
  },
});
