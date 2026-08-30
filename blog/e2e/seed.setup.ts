/**
 * E2E のフィクスチャを入れる。**テスト本体より先に 1 度だけ走る**
 * (`playwright.config.ts` の `dependencies`)。
 *
 * `e2e/fixtures/posts/` を portable import と同じ形の zip にして
 * `<mount>/api/import` に投げる。**生 SQL で seed しない**のは、添付の実体が R2 に
 * 要るから (SQL では D1 の行しか作れず、画像が置けない)。
 *
 * D1 と R2 は `--persist-to .wrangler/e2e` に分けてあり、webServer のコマンドが
 * 毎回捨てるので、ここは常に空の状態から始まる。
 */
import { expect, test as setup } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, type ZipEntry } from '../src/core/transfer/zip.ts';
import { MOUNT, ORIGIN } from './helpers.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/posts', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

setup('フィクスチャを取り込む', async ({ request }) => {
  const entries: ZipEntry[] = walk(FIXTURES)
    .filter((path) => !path.endsWith('README.md'))
    .map((path) => ({
      // 書庫の中は必ず `/` 区切り。Windows で走らせたときに `posts\a\index.md` に
      // なると、記事のパスとして読めない。
      path: `posts/${relative(FIXTURES, path).split(sep).join('/')}`,
      data: new Uint8Array(readFileSync(path)),
    }));
  expect(entries.length, 'フィクスチャが 1 つも無い').toBeGreaterThan(0);

  const res = await request.post(`${MOUNT}/api/import`, {
    // 管理 API は CSRF で Origin を見る。ブラウザと同じ形で出す。
    headers: { Origin: ORIGIN },
    multipart: {
      file: {
        name: 'fixtures.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(createZip(entries)),
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);

  const body = (await res.json()) as {
    imported: { path: string; warnings: string[] }[];
    failed: unknown[];
    ignored: unknown[];
  };
  // 取りこぼしを黙って許さない。フィクスチャが 1 本入らないまま「テストは通った」に
  // なるのがいちばん困る。
  expect(body.failed, '取り込めなかった記事がある').toEqual([]);
  expect(body.ignored, '記事として読まれなかったファイルがある').toEqual([]);
  // **警告も許さない。** 添付・alias・本文の参照が落ちるのはここにしか出ないので、
  // 見ないと「記事は入ったが画像が無い」状態で緑になる。
  expect(
    body.imported.flatMap((post) => post.warnings),
    'フィクスチャの取り込みで警告が出ている',
  ).toEqual([]);
  expect(body.imported.map((post) => post.path).sort()).toEqual([
    'aliased',
    'draft-example',
    'order-tie-a',
    'order-tie-b',
    'order-time-a',
    'order-time-z',
    'rendering-sample',
  ]);
});
