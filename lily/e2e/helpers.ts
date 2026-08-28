/**
 * E2E から見た配信先の定数。**mount を各所に散らさない。**
 *
 * `src/site/meta.ts` の `MOUNT_PATH` を変えたらここも変わる。テストの中に `/blog` を
 * 直接書くと、切り替え (`/blog-next` ↔ `/blog`) のたびに全 spec を書き換えることになる。
 */
import { normalizeMountPath } from '../src/core/paths.ts';
import { MOUNT_PATH } from '../src/site/meta.ts';

/**
 * テストサーバーのポート。**`playwright.config.ts` もここから読む。**
 * 2 箇所に書くと、片方だけ変えた日に Origin だけが古いまま CSRF で弾かれる。
 * wrangler dev の既定 (8787) とは分ける (dev を開いたままテストを回せるように)。
 */
export const PORT = 8788;
export const ORIGIN = `http://localhost:${PORT}`;

/** 先頭スラッシュ付き・末尾スラッシュ無し (`/blog`)。root mount なら空文字。 */
export const MOUNT: string = normalizeMountPath(MOUNT_PATH);

/** 記事・タグ・フィードの URL。`core/paths.ts` と同じ組み立てを通す。 */
export const url = {
  index: () => `${MOUNT}/`,
  post: (path: string) => `${MOUNT}/${path}/`,
  tag: (slug: string) => `${MOUNT}/tags/${slug}/`,
  asset: (name: string) => `${MOUNT}/${name}`,
};

/**
 * フィクスチャの identity。frontmatter に固定値を書いてある。
 *
 * **名指しで使うものだけ置く。** 他の記事はパスで引けるので、identity を並べても
 * 使われないまま古くなるだけ (フィクスチャ側の一覧は `e2e/fixtures/README.md`)。
 */
export const ID = {
  renderingSample: '00000000-0000-4000-8000-000000000001',
  draft: '00000000-0000-4000-8000-000000000006',
} as const;
