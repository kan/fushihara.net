/**
 * 公開側のルータ。**URL の形は `core/paths.ts` が、予約は `fixed.ts` が決める。**
 *
 * ここが持つのは「どのデータをどのテーマ関数に渡すか」と、308 の張り方だけ。
 */
import { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from '../config.ts';
import { getCanonicalPath, resolvePath } from '../db/post-paths.ts';
import { getPostByPreviewTokenHash, getPublishedPosts, getPublishedPostsByTagSlug } from '../db/posts.ts';
import { listMediaByPost } from '../db/media.ts';
import { storedOrRenderedHtml } from '../delivery.ts';
import { getTagBySlug, getTagsForPost, getTagsForPosts } from '../db/tags.ts';
import { createUrls, normalizePostPath } from '../paths.ts';
import { renderMarkdown } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import type { PageContext } from '../theme.ts';
import { hashPreviewToken } from '../tokens.ts';
import { groupTags, toPostSummary, toPostView, toTagView } from '../view.ts';
import { NO_STORE, SHORT_EDGE, LONG_EDGE } from './cache.ts';
import { ROUTE } from './fixed.ts';
import { createNotFound } from './not-found.ts';

type Env = { Bindings: LilyBindings };

export function publicRoutes(config: LilyConfig): Hono<Env> {
  const app = new Hono<Env>();
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });
  const mount = urls.mountPath;
  const { theme } = config;
  // 中身が変わるのはデプロイのときだけなので、ETag は起動時に 1 度だけ組む。
  const stylesheetETag = `"${hash(theme.stylesheet)}"`;

  /**
   * 308 の飛び先。**クエリ文字列を落とさない。**
   *
   * 計測パラメータ付きの共有リンク (`?utm_source=…`) は末尾スラッシュ補正に
   * 引っかかりやすく、ここで落とすと計測が丸ごと消える (本体側で同種の事故を
   * 踏んでいる)。
   */
  const redirectTo = (path: string, requestUrl: string): string =>
    `${path}${new URL(requestUrl).search}`;

  const context = (canonicalUrl: string | null): PageContext => ({
    site: config.site,
    urls,
    canonicalUrl,
  });

  const notFound = createNotFound(config);

  // マウント直下のスラッシュ無し。`/blog` → `/blog/`
  if (mount !== '') {
    app.get(mount, (c) => c.redirect(redirectTo(urls.index(), c.req.url), 308));
  }

  app.get(urls.index(), async (c) => {
    const db = c.env.DB;
    const posts = await getPublishedPosts(db);
    const tags = groupTags(await getTagsForPosts(db, posts.map((p) => p.id)));
    const views = posts.map((p) => toPostSummary(urls, p, tags.get(p.id) ?? []));

    return c.html(await theme.index(context(urls.index({ absolute: true })), views), 200, {
      'Cache-Control': SHORT_EDGE,
    });
  });

  app.get(urls.stylesheet(), (c) => {
    // 中身が変わるのはデプロイのときだけ。返すだけで見ないと ETag は飾りになる。
    if (c.req.header('If-None-Match') === stylesheetETag) {
      return new Response(null, {
        status: 304,
        headers: { 'Cache-Control': LONG_EDGE, ETag: stylesheetETag },
      });
    }
    return c.body(theme.stylesheet, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': LONG_EDGE,
      ETag: stylesheetETag,
    });
  });

  app.get(`${mount}/${ROUTE.tags}/:slug`, (c) =>
    c.redirect(redirectTo(urls.tag({ slug: c.req.param('slug') }), c.req.url), 308),
  );

  app.get(`${mount}/${ROUTE.tags}/:slug/`, async (c) => {
    const db = c.env.DB;
    const slug = c.req.param('slug');
    const tag = await getTagBySlug(db, slug);
    if (!tag) return await notFound();

    const posts = await getPublishedPostsByTagSlug(db, slug);
    const tags = groupTags(await getTagsForPosts(db, posts.map((p) => p.id)));
    const views = posts.map((p) => toPostSummary(urls, p, tags.get(p.id) ?? []));
    const view = toTagView(urls, tag);

    return c.html(await theme.tag(context(urls.tag(tag, { absolute: true })), view, views), 200, {
      'Cache-Control': SHORT_EDGE,
    });
  });

  // 下書きプレビュー。**公開ページと同じ renderer を通す**が、毎回 body_md から
  // 描画してキャッシュしない (保存直後の姿を見るためのもの)。
  app.get(`${mount}/${ROUTE.preview}/:token`, async (c) => {
    const db = c.env.DB;
    const post = await getPostByPreviewTokenHash(db, await hashPreviewToken(c.req.param('token')));
    if (!post) return await notFound();

    const canonical = (await getCanonicalPath(db, post.id)) ?? post.public_id;
    // 保存済みの HTML は使わない。保存直後の姿を見るためのページなので、
    // 毎回 body_md から描き直す (キャッシュもしない)。
    const rendered = await renderMarkdown(post.body_md, {
      media: await listMediaByPost(db, post.id),
    });
    const html = resolveMediaUrls(rendered.html, urls);
    const view = toPostView(urls, post, canonical, await getTagsForPost(db, post.id), html);

    return c.html(await theme.post(context(null), view), 200, {
      'Cache-Control': NO_STORE,
      'X-Robots-Tag': 'noindex',
    });
  });

  app.get(`${mount}/*`, async (c) => {
    const db = c.env.DB;
    // ワイルドカードは名前付きパラメータとして取れないので、パスから直接切り出す。
    // mount とその後ろのスラッシュを落とした残りが記事のパス。
    const requested = c.req.path.slice(mount.length + 1);

    // リクエストのパスも保存時と同じ規則で正規化する。ここを別実装にすると、
    // 保存できたのに引けない (あるいはその逆の) パスが生まれる。
    const normalized = normalizePostPath(requested);
    if (!normalized.ok) return await notFound();

    const resolved = await resolvePath(db, normalized.value);
    if (!resolved) return await notFound();

    // 公開判定は 308 より先。後にすると、下書きのパスを当てられたときに
    // リダイレクトの有無で存在が分かってしまう。
    if (resolved.status !== 'published') return await notFound();

    // alias・大小文字違い・末尾スラッシュ無し・連続スラッシュ・エンコードの揺れを
    // まとめて canonical へ寄せる。**比較はリクエストのパスそのもの**で行う。
    // 正規化後の値だけを見ると、`//now/` のように正規化で消える差が残ってしまい、
    // 同じ記事が 2 つの URL で 200 を返す。飛び先は自分自身と一致するので、
    // 308 が繰り返すことはない。
    const canonicalPath = urls.post(resolved.canonical_path);
    if (c.req.path !== canonicalPath) {
      return c.redirect(redirectTo(canonicalPath, c.req.url), 308);
    }

    const stored = await storedOrRenderedHtml(resolved, () => listMediaByPost(db, resolved.id));
    const html = resolveMediaUrls(stored, urls);
    const view = toPostView(
      urls,
      resolved,
      resolved.canonical_path,
      await getTagsForPost(db, resolved.id),
      html,
    );

    return c.html(await theme.post(context(urls.post(resolved.canonical_path, { absolute: true })), view), 200, {
      'Cache-Control': SHORT_EDGE,
    });
  });

  return app;
}

/** ETag 用の軽いハッシュ。衝突しても 304 が減るだけなので暗号強度は要らない。 */
function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
