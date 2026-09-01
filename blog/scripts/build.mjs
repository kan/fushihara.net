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
// favicon 3 点。実体は本体サイトと共有 (lily を切り出すときはサイト側の
// ディレクトリから来る)。
await cp(join(root, '..', 'shared', 'public'), dist, { recursive: true });
// **ブログ専用のものを後から被せる。** 同じ名前があればこちらが勝つ。
// 今は ogp.png（本体は「fushihara.net」、ブログは「ふしはらねっとのぶろぐ」）。
// 共有に置くと 1 枚しか持てず、どちらのリンクを貼っても同じ絵が出る。
await cp(join(root, 'public'), dist, { recursive: true });

console.log(`静的アセットを ${dist} に置いた`);
