/**
 * 保存してある HTML と、その場で描画する HTML の使い分け。
 *
 * `body_html` は派生データ (キャッシュ) なので、あればそれを使う。
 * 無いときだけ `body_md` から描画する。どちらの経路も同じ renderer を通る。
 */
import type { PostRow } from './db/types.ts';
import type { MediaRef } from './paths.ts';
import { renderMarkdown } from './render/index.ts';

/**
 * `loadMedia` は **`body_html` が無いときだけ**呼ばれる。添付の取得は
 * 描画にしか要らないので、保存済みの HTML があるときに問い合わせを増やさない。
 */
export async function storedOrRenderedHtml(
  post: Pick<PostRow, 'body_html' | 'body_md'>,
  loadMedia: () => Promise<readonly MediaRef[]>,
): Promise<string> {
  if (post.body_html !== null) return post.body_html;
  return (await renderMarkdown(post.body_md, { media: await loadMedia() })).html;
}
