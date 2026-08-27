/**
 * 管理 API。**`<mount>/api` にマウントされる前提**で、ここでのパスは `/posts` の
 * ように mount を知らない形にしてある。Hono RPC の型がリテラルのまま残るので、
 * 管理画面は `hc<LilyApi>('<mount>/api')` だけで全エンドポイントに型が付く。
 *
 * リクエストの検証は zod を `zValidator` で 1 度だけ書き、**レスポンスの型は
 * handler から推論**させる。手で書いた型と実装がずれる余地を作らない。
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { AuthUser } from '../auth/index.ts';
import type { LilyBindings, PageConfig } from '../config.ts';
import { renderAndStore } from '../delivery.ts';
import {
  createMedia,
  deleteMedia,
  findByPostAndFilename,
  getMediaByPublicId,
  listMediaByPost,
} from '../db/media.ts';
import { addAlias, changeCanonicalPath, removePath } from '../db/post-paths.ts';
import {
  countPosts,
  countPostsNeedingRender,
  createPost,
  deletePost,
  getPostById,
  getPostByPublicId,
  listAllPosts,
  listPostsNeedingRender,
  publishPost,
  setPreviewToken,
  unpublishPost,
  updatePost,
} from '../db/posts.ts';
import { applyTags, listTagsWithCounts, resolveTags } from '../db/tags.ts';
import type { PostRow } from '../db/types.ts';
import { fetchLinkTitle } from '../link-title.ts';
import { createUrls, normalizeSegment, type Urls } from '../paths.ts';
import { RENDERER_VERSION, renderMarkdown } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import { hashPreviewToken, newPreviewToken } from '../tokens.ts';
import { uniqueViolationTarget } from '../db/errors.ts';
import { apiError } from './errors.ts';
import {
  createPostSchema,
  linkTitleSchema,
  listPostsSchema,
  pathSchema,
  publishSchema,
  renderSchema,
  updatePostSchema,
} from './schema.ts';
import { toMediaView, toPostView } from './view.ts';

/**
 * API が要求する形。**バインディングでジェネリックにしない。**
 * 認証アダプタを作るのに要る deployment 固有の設定は `routes/api.ts` の
 * ミドルウェア側が受け持つので、こちらは core が使う分だけ知っていればよい。
 */
export type ApiEnv = {
  Bindings: LilyBindings;
  Variables: { user: AuthUser };
};

/** 添付として受け付ける形式。**任意の Content-Type を配らせない。** */
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
]);

/** 添付の上限。R2 は大きくても置けるが、記事の挿し絵にこれ以上は要らない。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 1 回の再描画で扱う記事の数。1 記事あたり D1 に数回問い合わせるので、
 * Workers の subrequest の上限に当たらない範囲に抑える。
 */
const RERENDER_BATCH = 50;

export function createApi(config: PageConfig) {
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });
  const api = new Hono<ApiEnv>();

  return api
    .get('/me', (c) => c.json({ user: c.get('user') }))

    /**
     * 編集中のプレビュー。**保存しない。**
     *
     * 公開ページと同じ renderer と同じ resolver を通すので、書きながら見ている
     * ものと出るものが食い違わない。管理画面に Markdown のパーサを 2 本目として
     * 持ち込まずに済む、という意味でもある。
     */
    .post('/render', zValidator('json', renderSchema), async (c) => {
      const db = c.env.DB;
      const { bodyMd, publicId } = c.req.valid('json');
      const post = publicId ? await getPostByPublicId(db, publicId) : null;
      const media = post ? await listMediaByPost(db, post.id) : [];

      const rendered = await renderMarkdown(bodyMd, { media });
      return c.json({
        html: resolveMediaUrls(rendered.html, urls),
        unresolvedMedia: rendered.unresolvedMedia,
      });
    })

    /** タグの補完に使う。件数の多い順。 */
    .get('/tags', async (c) => {
      const tags = await listTagsWithCounts(c.env.DB);
      return c.json({ tags: tags.map((tag) => ({ name: tag.name, count: tag.post_count })) });
    })

    /**
     * 貼り付けた URL のタイトル。ブラウザからは CORS で読めないので代わりに取る。
     * 取れなくても書くのを止めないよう、失敗は `title: null` で返す。
     */
    .post('/link-title', zValidator('json', linkTitleSchema), async (c) => {
      return c.json(await fetchLinkTitle(c.req.valid('json').url));
    })

    .get('/posts', zValidator('query', listPostsSchema), async (c) => {
      const db = c.env.DB;
      const { status, limit, offset } = c.req.valid('query');
      // 総件数も返す。無いと管理画面が「次のページがあるか」を出せない。
      const [posts, total] = await Promise.all([
        listAllPosts(db, { status, limit, offset }),
        countPosts(db, status),
      ]);
      return c.json({
        total,
        limit,
        offset,
        posts: posts.map((post) => ({
          publicId: post.public_id,
          title: post.title,
          description: post.description,
          status: post.status,
          publishedAt: post.published_at,
          updatedAt: post.updated_at,
          canonicalPath: post.canonical_path,
          url: urls.post(post.canonical_path),
        })),
      });
    })

    .post('/posts', zValidator('json', createPostSchema), async (c) => {
      const db = c.env.DB;
      const input = c.req.valid('json');

      // **タグは記事を作る前に検証する。** 作ってから弾くと、失敗を返したのに
      // 記事だけ残り、同じパスで作り直すと 409 になって手詰まりになる。
      const tags = await resolveTags(db, input.tags ?? []);
      if (!tags.ok) return c.json(...apiError(tags.error.code, tags.error.name));

      const created = await createPost(db, {
        title: input.title,
        bodyMd: input.bodyMd,
        description: input.description,
        path: input.path,
        publishedAt: input.publishedAt,
      });
      if (!created.ok) return c.json(...apiError(created.error.code, created.error.segment));

      if (input.tags) await applyTags(db, created.value.id, tags.value);
      return c.json(await save(db, urls, created.value), 201);
    })

    .get('/posts/:publicId', async (c) => {
      const post = await getPostByPublicId(c.env.DB, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));
      // **GET は書き込まない。** body_html は最後の保存で作ってある。
      return c.json({ post: await toPostView(c.env.DB, urls, post) });
    })

    .patch('/posts/:publicId', zValidator('json', updatePostSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const input = c.req.valid('json');
      if (input.tags) {
        const tags = await resolveTags(db, input.tags);
        if (!tags.ok) return c.json(...apiError(tags.error.code, tags.error.name));
        await applyTags(db, post.id, tags.value);
      }

      const updated = await updatePost(db, post.id, {
        title: input.title,
        description: input.description,
        body_md: input.bodyMd,
        published_at: input.publishedAt,
      });
      if (!updated) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, updated));
    })

    .delete('/posts/:publicId', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      // R2 のオブジェクト削除は**コミット後**。失敗分は残骸として残るが、
      // DB を巻き戻すより安い。
      const keys = await deletePost(db, post.id);
      // allSettled なのは、R2 の 1 つが失敗しても 200 を返しきるため。DB は
      // もうコミット済みで、消せなかったぶんは孤児として残す方が安い。
      await Promise.allSettled(keys.map((key) => c.env.MEDIA.delete(key)));
      return c.json({ deleted: post.public_id });
    })

    .post('/posts/:publicId/publish', zValidator('json', publishSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const published = await publishPost(db, post.id, c.req.valid('json').publishedAt);
      if (!published) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, published));
    })

    .post('/posts/:publicId/unpublish', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const draft = await unpublishPost(db, post.id);
      if (!draft) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, draft));
    })

    // canonical の張り替え。**旧パスは alias として残る**ので、共有された URL は生き続ける。
    .put('/posts/:publicId/path', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const changed = await changeCanonicalPath(db, post.id, c.req.valid('json').path);
      if (!changed.ok) return c.json(...apiError(changed.error.code, changed.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    .post('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const added = await addAlias(db, post.id, c.req.valid('json').path);
      if (!added.ok) return c.json(...apiError(added.error.code, added.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    .delete('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const removed = await removePath(db, post.id, c.req.valid('json').path);
      if (!removed.ok) return c.json(...apiError(removed.error.code, removed.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    // プレビュー URL の発行。**生のトークンを返すのはこの 1 回だけ**で、
    // DB に入るのは SHA-256 のハッシュ。
    .post('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const token = newPreviewToken();
      await setPreviewToken(db, post.id, await hashPreviewToken(token));
      // **絶対 URL にはしない。** 設定の site.url を使うと、ローカルで発行した
      // リンクが本番のホストを指して開けなくなる。管理画面は必ず配信元と同じ
      // オリジンで動いているので、そちらで `location.origin` と繋ぐ方が正しい。
      return c.json({ path: urls.preview(token) });
    })

    .delete('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      await setPreviewToken(db, post.id, null);
      return c.json({ revoked: post.public_id });
    })

    .post('/posts/:publicId/media', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const form = await c.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return c.json(...apiError('file-required'));
      if (file.size === 0) return c.json(...apiError('file-empty'));
      if (file.size > MAX_UPLOAD_BYTES) return c.json(...apiError('file-too-large'));
      if (!ALLOWED_MIME.has(file.type)) return c.json(...apiError('mime-not-allowed', file.type));

      // ファイル名は記事のパスと同じ規則で見る。export でそのままディレクトリに
      // 書き出すので、書ける形であることまで含めて縛る。
      const filename = normalizeSegment(String(form.get('filename') ?? file.name));
      if (!filename.ok) return c.json(...apiError(filename.error.code));

      // **DB を先に入れてから R2 に置く。** r2Key は (記事, ファイル名) から
      // 決まるので、逆順にすると 2 回目の upload が既存の実体を上書きしてから
      // 409 を返すことになる (「失敗した」と言いながら元の画像は消えている)。
      if (await findByPostAndFilename(db, post.id, filename.value)) {
        return c.json(...apiError('filename-taken', filename.value));
      }

      const r2Key = `posts/${post.public_id}/${filename.value}`;
      let media;
      try {
        media = await createMedia(db, {
          postId: post.id,
          filename: filename.value,
          r2Key,
          mime: file.type,
          bytes: file.size,
        });
      } catch (error) {
        // 上の SELECT との間に同じ名前を作られた場合だけ 409。それ以外
        // (D1 の一時的な失敗など) を握り潰すと、名前を変えても直らない
        // 「ファイル名の衝突」を延々と見せることになる。
        if (uniqueViolationTarget(error) !== null) {
          return c.json(...apiError('filename-taken', filename.value));
        }
        throw error;
      }

      await c.env.MEDIA.put(r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });

      // 本文の `./<filename>` が解決できるようになるので描き直す。
      const unresolved = await renderAndStore(db, post);
      return c.json({ media: toMediaView(urls, media), unresolvedMedia: unresolved }, 201);
    })

    .delete('/media/:publicId', async (c) => {
      const db = c.env.DB;
      const media = await getMediaByPublicId(db, c.req.param('publicId'));
      if (!media) return c.json(...apiError('not-found'));

      const key = await deleteMedia(db, media.id);
      if (key) await c.env.MEDIA.delete(key);

      // **消したら描き直す。** body_html は配信される実体なので、そのままだと
      // 消えた画像を指す <img> が公開ページに残り続ける。
      const owner = media.post_id === null ? null : await getPostById(db, media.post_id);
      const unresolvedMedia = owner ? await renderAndStore(db, owner) : [];
      return c.json({ deleted: media.public_id, unresolvedMedia });
    })

    /**
     * `body_html` は派生データなので、renderer を更新したら作り直す。
     * 下書きも含めて、**今の renderer で描かれていない記事だけ**が対象。
     *
     * 1 回で処理する数に上限を置き、残りを返す。Workers の subrequest には
     * 上限があるので、黙って打ち切ると「成功したのに古いままの記事」が残る。
     * 呼び出し側は `remaining` が 0 になるまで呼ぶ。
     */
    .post('/rerender', async (c) => {
      const db = c.env.DB;
      const posts = await listPostsNeedingRender(db, RENDERER_VERSION, RERENDER_BATCH);
      const warnings: { publicId: string; unresolvedMedia: readonly string[] }[] = [];

      for (const post of posts) {
        const unresolved = await renderAndStore(db, post);
        if (unresolved.length > 0) {
          warnings.push({ publicId: post.public_id, unresolvedMedia: unresolved });
        }
      }
      const remaining = await countPostsNeedingRender(db, RENDERER_VERSION);
      return c.json({ rendered: posts.length, remaining, warnings });
    });
}

export type LilyApi = ReturnType<typeof createApi>;

/**
 * 本文が変わる操作のあとの応答。**ここでだけ描き直す。**
 *
 * 配信側は保存済みの `body_html` をそのまま出すので、書き換えたら作り直す。
 * 逆に読み取りやパスの操作では呼ばない (GET が書き込む副作用を作らない)。
 */
async function save(db: D1Database, urls: Urls, post: PostRow) {
  const unresolvedMedia = await renderAndStore(db, post);
  const fresh = (await getPostByPublicId(db, post.public_id)) ?? post;
  return { post: await toPostView(db, urls, fresh), unresolvedMedia };
}
