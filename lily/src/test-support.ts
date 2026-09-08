/**
 * 利用側が自分の vitest スイートを持つときの下ごしらえ。
 * **`@kanf/lily/test-support` から読む。**
 *
 * **このモジュールは `cloudflare:test` を import する。** あれは
 * `@cloudflare/vitest-plugin` のプールの中にしか無い仮想モジュールなので、
 * ここを本番のコードから読んではいけない（バンドルの段で解決できずに落ちる）。
 * 公開 API の他のものと分けてあるのはそのため。
 */
import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';

/**
 * migrations を流し込むバインディングの名前。**設定側と読み込み側の待ち合わせ場所。**
 *
 * `vitest.config.ts` が `readD1Migrations()` の結果をこの名前で miniflare に渡し、
 * setup file が同じ名前で受け取る。文字列を 2 箇所に書くと、片方を変えた日に
 * 「マイグレーションが当たっていない D1」で全テストが落ちる。
 *
 * **`Cloudflare.Env` を augment しない。** そうすると本番の `Env` にも生えてしまい、
 * テストにしか無いものを利用側のコードから触れるようになる。
 */
export const TEST_MIGRATIONS_BINDING = 'TEST_MIGRATIONS';

/**
 * 各テストファイルの D1 に `migrations/*.sql` を適用する。
 * **vitest の `setupFiles` から呼ぶ。**
 *
 * ```ts
 * // test/apply-migrations.ts
 * import { applyTestMigrations } from '@kanf/lily/test-support';
 * await applyTestMigrations();
 * ```
 *
 * `isolatedStorage` が効いているので、ここで作ったスキーマはファイル内で共有され、
 * テストごとの書き込みはテストの終わりに巻き戻る。
 */
export async function applyTestMigrations(): Promise<void> {
  const migrations = (env as unknown as Record<string, D1Migration[]>)[TEST_MIGRATIONS_BINDING];
  if (!migrations) {
    throw new Error(
      `${TEST_MIGRATIONS_BINDING} が無い。vitest.config.ts の miniflare.bindings に ` +
        'readD1Migrations() の結果をこの名前で渡すこと。',
    );
  }
  await applyD1Migrations(env.DB, migrations);
}
