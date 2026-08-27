/**
 * 管理 API が返す形。
 *
 * **Row をそのまま出さない。** `preview_token_hash` を漏らさないためと、
 * `body_html` のような派生データを管理画面に持たせないため。ここが唯一の
 * 出口なので、列を足しても勝手に外へ出ることがない。
 */
import { listMediaByPost } from '../db/media.ts';
import { listPaths } from '../db/post-paths.ts';
import { getTagsForPost } from '../db/tags.ts';
import type { MediaRow, PostRow } from '../db/types.ts';
import type { Urls } from '../paths.ts';

export type MediaView = {
  publicId: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string;
};

export type PostView = {
  publicId: string;
  title: string;
  description: string | null;
  bodyMd: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  /** プレビュー URL を発行済みか。**トークンそのものは発行時にしか返さない。** */
  hasPreview: boolean;
  blueskyUri: string | null;
  canonicalPath: string;
  url: string;
  paths: { path: string; isCanonical: boolean }[];
  tags: { name: string; slug: string }[];
  media: MediaView[];
};

export function toMediaView(urls: Urls, media: MediaRow): MediaView {
  return {
    publicId: media.public_id,
    filename: media.filename,
    mime: media.mime,
    bytes: media.bytes,
    url: urls.media(media),
  };
}

/** 記事 1 件の詳細。paths / tags / media をまとめて引く。 */
export async function toPostView(db: D1Database, urls: Urls, post: PostRow): Promise<PostView> {
  const [paths, tags, media] = await Promise.all([
    listPaths(db, post.id),
    getTagsForPost(db, post.id),
    listMediaByPost(db, post.id),
  ]);
  const canonical = paths.find((p) => p.is_canonical === 1)?.path ?? post.public_id;

  return {
    publicId: post.public_id,
    title: post.title,
    description: post.description,
    bodyMd: post.body_md,
    status: post.status,
    publishedAt: post.published_at,
    updatedAt: post.updated_at,
    createdAt: post.created_at,
    hasPreview: post.preview_token_hash !== null,
    blueskyUri: post.bluesky_uri,
    canonicalPath: canonical,
    url: urls.post(canonical),
    paths: paths.map((p) => ({ path: p.path, isCanonical: p.is_canonical === 1 })),
    tags: tags.map((t) => ({ name: t.name, slug: t.slug })),
    media: media.map((m) => toMediaView(urls, m)),
  };
}
