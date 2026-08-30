/**
 * 配信する静的アセットを 1 つのディレクトリにまとめる。
 *
 * `wrangler.jsonc` の `assets.directory` はプロジェクトに 1 つしか持てないので、
 * 本体サイトと共有の `shared/public` と、管理画面のビルド成果物をここで合流させる。
 *
 * 管理画面のビルド (`vite build`) は別に走る。こちらは**コピーだけ**なので速く、
 * テストの前段としても回せる。
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });
// favicon 3 点と ogp.png。実体は本体サイトと共有 (lily を切り出すときは
// サイト側のディレクトリから来る)。
await cp(join(root, '..', 'shared', 'public'), dist, { recursive: true });

console.log(`静的アセットを ${dist} に置いた`);
