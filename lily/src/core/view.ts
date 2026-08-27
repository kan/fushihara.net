/**
 * Row 型 → テーマに渡す view model。
 *
 * URL を組むのと日付を Date にするのがここの仕事。テーマが Row 型や
 * `post_paths` の存在を知らずに済むようにする。
 */
import type { PostRow, PostWithPathRow, TagRow } from './db/types.ts';
import type { Urls } from './paths.ts';
import type { PostSummaryView, PostView, TagView } from './theme.ts';

export function toTagView(urls: Urls, tag: TagRow): TagView {
  return { name: tag.name, slug: tag.slug, url: urls.tag(tag) };
}

export function toPostSummary(
  urls: Urls,
  row: PostWithPathRow,
  tags: readonly TagRow[] = [],
): PostSummaryView {
  return {
    title: row.title,
    description: row.description,
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    updatedAt: new Date(row.updated_at),
    url: urls.post(row.canonical_path),
    tags: tags.map((t) => toTagView(urls, t)),
    isDraft: row.status === 'draft',
  };
}

export function toPostView(
  urls: Urls,
  row: PostRow,
  canonicalPath: string,
  tags: readonly TagRow[],
  html: string,
): PostView {
  return { ...toPostSummary(urls, { ...row, canonical_path: canonicalPath }, tags), html };
}

/** 一覧で N+1 を避けるための、記事 id → タグの割り当て。 */
export function groupTags(
  rows: readonly (TagRow & { post_id: number })[],
): Map<number, TagRow[]> {
  const byPost = new Map<number, TagRow[]>();
  for (const row of rows) {
    const list = byPost.get(row.post_id);
    if (list) list.push(row);
    else byPost.set(row.post_id, [row]);
  }
  return byPost;
}
