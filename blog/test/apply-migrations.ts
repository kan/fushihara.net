import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-plugin';

// 各テストファイルの D1 に migrations/*.sql を適用する。isolatedStorage が
// 効いているので、ここで作ったスキーマはファイル内で共有され、テストごとの
// 書き込みはテストの終わりに巻き戻る。
//
// TEST_MIGRATIONS は vitest.config.ts が miniflare のバインディングとして流し込む
// テスト専用の値。Cloudflare.Env を augment すると本番の Env にも生えてしまうので、
// ここだけキャストで受ける。
const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;

await applyD1Migrations(env.DB, migrations);
