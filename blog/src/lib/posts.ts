import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/**
 * 公開対象の記事を新しい順で返す。draft は本番ビルドでのみ落とす
 * (dev では書きかけを確認したいため)。
 *
 * date が同じときは slug の昇順。ここを明示しないと getCollection が返す順
 * (= glob loader の都合) がそのまま出てしまい、Astro 側の実装が変わった日に
 * 一覧と RSS の並びが黙って変わる。
 * 同日内の順序を自分で決めたいときは date に時刻を付ける (`2026-08-23T21:00:00+09:00`)。
 */
export async function publishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => import.meta.env.PROD ? !data.draft : true);
  return posts.sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime() || compare(a.id, b.id),
  );
}

/** localeCompare は環境の ICU に依存するので、コードポイント順で固定する */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
