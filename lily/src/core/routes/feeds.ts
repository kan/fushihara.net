/**
 * 機械向けの出力: フィード・サイトマップ・静的アセット。
 *
 * 人が読むページは `public.ts`。分けてあるのは、こちらが**テーマを一切通らない**
 * ため (見た目の差し替えでフィードの形が変わってはいけない)。
 */
import { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from '../config.ts';
import { listMediaByPosts } from '../db/media.ts';
import { getPublishedPosts } from '../db/posts.ts';
import { listTagsWithCounts } from '../db/tags.ts';
import type { PostWithPathRow } from '../db/types.ts';
import { storedOrRenderedHtml } from '../delivery.ts';
import { buildAtom, buildRss, type FeedEntry } from '../feed/index.ts';
import { toFeedHtml } from '../feed/html.ts';
import { createUrls, type MediaRef, type Urls } from '../paths.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import { buildSitemap, buildSitemapIndex } from '../sitemap.ts';
import { LONG_EDGE, SHORT_EDGE } from './cache.ts';
import { ROUTE, STATIC_ASSETS } from './fixed.ts';

type Env = { Bindings: LilyBindings };

export function feedRoutes(config: LilyConfig): Hono<Env> {
  const app = new Hono<Env>();
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });
  const mount = urls.mountPath;

  const xml = (body: string, cache = SHORT_EDGE): Response =>
    new Response(body, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': cache },
    });

  app.get(urls.feed('rss'), async (c) =>
    xml(buildRss(config.site, urls, await feedEntries(c.env.DB, urls))),
  );

  app.get(urls.feed('atom'), async (c) =>
    xml(buildAtom(config.site, urls, await feedEntries(c.env.DB, urls))),
  );

  app.get(urls.sitemap(), () =>
    xml(buildSitemapIndex(`${urls.index({ absolute: true })}${ROUTE.sitemapUrls}`), LONG_EDGE),
  );

  app.get(`${mount}/${ROUTE.sitemapUrls}`, async (c) => {
    const db = c.env.DB;
    const [posts, tags] = await Promise.all([getPublishedPosts(db), listTagsWithCounts(db)]);

    return xml(
      buildSitemap([
        { url: urls.index({ absolute: true }) },
        ...posts.map((post) => ({
          url: urls.post(post.canonical_path, { absolute: true }),
          lastModified: new Date(post.updated_at),
        })),
        // 公開記事が付いているタグだけ。0 件のタグページを索引に出しても意味がない。
        ...tags
          .filter((tag) => tag.post_count > 0)
          .map((tag) => ({ url: urls.tag(tag, { absolute: true }) })),
      ]),
    );
  });

  // favicon 3 点と ogp.png。実体は本体サイトと共有の shared/public にあり、
  // 静的アセットの URL はディレクトリ直下からの相対になる。`<mount>/favicon.svg`
  // へは binding 経由で読み替えて出す。
  for (const name of STATIC_ASSETS) {
    app.get(`${mount}/${name}`, (c) => c.env.ASSETS.fetch(new URL(`/${name}`, c.req.url)));
  }

  return app;
}

/**
 * フィードに載せる記事。
 *
 * 本文は記事ページと同じ HTML を使い、media の placeholder を**絶対 URL**で
 * 解決してから `toFeedHtml` に通す (リーダーは記事の URL を起点に相対 URL を
 * 解決してくれない)。
 */
async function feedEntries(db: D1Database, urls: Urls): Promise<FeedEntry[]> {
  const posts = await getPublishedPosts(db);
  const mediaByPost = await loadMediaFor(db, posts);

  return await Promise.all(
    posts.map(async (post) => {
      const url = urls.post(post.canonical_path, { absolute: true });
      const stored = await storedOrRenderedHtml(post, async () => mediaByPost.get(post.id) ?? []);
      return {
        publicId: post.public_id,
        title: post.title,
        description: post.description,
        url,
        // 公開記事なので published_at は必ずある (DB の CHECK)。
        publishedAt: new Date(post.published_at as string),
        updatedAt: new Date(post.updated_at),
        html: toFeedHtml(resolveMediaUrls(stored, urls, { absolute: true }), url),
      };
    }),
  );
}

/**
 * `body_html` がまだ無い記事のぶんだけ添付をまとめて引く。
 * 全部そろっていれば問い合わせない。
 */
async function loadMediaFor(
  db: D1Database,
  posts: readonly PostWithPathRow[],
): Promise<Map<number, MediaRef[]>> {
  const needsRender = posts.filter((post) => post.body_html === null).map((post) => post.id);
  const byPost = new Map<number, MediaRef[]>();
  for (const media of await listMediaByPosts(db, needsRender)) {
    if (media.post_id === null) continue;
    const list = byPost.get(media.post_id);
    if (list) list.push(media);
    else byPost.set(media.post_id, [media]);
  }
  return byPost;
}
