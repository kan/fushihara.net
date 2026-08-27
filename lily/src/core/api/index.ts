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
import { createMedia, deleteMedia, getMediaByPublicId } from '../db/media.ts';
import { addAlias, changeCanonicalPath, removePath } from '../db/post-paths.ts';
import {
  createPost,
  deletePost,
  getPostByPublicId,
  listAllPosts,
  publishPost,
  unpublishPost,
  updatePost,
} from '../db/posts.ts';
import { setPostTags } from '../db/tags.ts';
import type { PostRow } from '../db/types.ts';
import { createUrls, normalizeSegment, type Urls } from '../paths.ts';
import { hashPreviewToken, newPreviewToken } from '../tokens.ts';
import { apiError } from './errors.ts';
import {
  createPostSchema,
  listPostsSchema,
  pathSchema,
  publishSchema,
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

export function createApi(config: PageConfig) {
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });
  const api = new Hono<ApiEnv>();

  return api
    .get('/me', (c) => c.json({ user: c.get('user') }))

    .get('/posts', zValidator('query', listPostsSchema), async (c) => {
      const { status, limit, offset } = c.req.valid('query');
      const posts = await listAllPosts(c.env.DB, { status, limit, offset });
      return c.json({
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
      const input = c.req.valid('json');
      const created = await createPost(c.env.DB, {
        title: input.title,
        bodyMd: input.bodyMd,
        description: input.description,
        path: input.path,
      });
      if (!created.ok) return c.json(...apiError(created.error.code, created.error.segment));

      const tagged = await applyTags(c.env.DB, created.value.id, input.tags);
      if (tagged) return c.json(...tagged);

      return c.json(await detail(c.env.DB, urls, created.value), 201);
    })

    .get('/posts/:publicId', async (c) => {
      const post = await getPostByPublicId(c.env.DB, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));
      return c.json(await detail(c.env.DB, urls, post));
    })

    .patch('/posts/:publicId', zValidator('json', updatePostSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const input = c.req.valid('json');
      const tagged = await applyTags(db, post.id, input.tags);
      if (tagged) return c.json(...tagged);

      const updated = await updatePost(db, post.id, {
        title: input.title,
        description: input.description,
        body_md: input.bodyMd,
      });
      if (!updated) return c.json(...apiError('post-not-found'));
      return c.json(await detail(db, urls, updated));
    })

    .delete('/posts/:publicId', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      // R2 のオブジェクト削除は**コミット後**。失敗分は残骸として残るが、
      // DB を巻き戻すより安い。
      const keys = await deletePost(db, post.id);
      await Promise.all(keys.map((key) => c.env.MEDIA.delete(key)));
      return c.json({ deleted: post.public_id });
    })

    .post('/posts/:publicId/publish', zValidator('json', publishSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const published = await publishPost(db, post.id, c.req.valid('json').publishedAt);
      if (!published) return c.json(...apiError('post-not-found'));
      return c.json(await detail(db, urls, published));
    })

    .post('/posts/:publicId/unpublish', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const draft = await unpublishPost(db, post.id);
      if (!draft) return c.json(...apiError('post-not-found'));
      return c.json(await detail(db, urls, draft));
    })

    // canonical の張り替え。**旧パスは alias として残る**ので、共有された URL は生き続ける。
    .put('/posts/:publicId/path', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const changed = await changeCanonicalPath(db, post.id, c.req.valid('json').path);
      if (!changed.ok) return c.json(...apiError(changed.error.code, changed.error.segment));
      return c.json(await detail(db, urls, post));
    })

    .post('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const added = await addAlias(db, post.id, c.req.valid('json').path);
      if (!added.ok) return c.json(...apiError(added.error.code, added.error.segment));
      return c.json(await detail(db, urls, post));
    })

    .delete('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const removed = await removePath(db, post.id, c.req.valid('json').path);
      if (!removed.ok) return c.json(...apiError(removed.error.code, removed.error.segment));
      return c.json(await detail(db, urls, post));
    })

    // プレビュー URL の発行。**生のトークンを返すのはこの 1 回だけ**で、
    // DB に入るのは SHA-256 のハッシュ。
    .post('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const token = newPreviewToken();
      await updatePost(db, post.id, { preview_token_hash: await hashPreviewToken(token) });
      return c.json({ url: urls.preview(token, { absolute: true }) });
    })

    .delete('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      await updatePost(db, post.id, { preview_token_hash: null });
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

      const r2Key = `posts/${post.public_id}/${filename.value}`;
      await c.env.MEDIA.put(r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });

      let media;
      try {
        media = await createMedia(db, {
          postId: post.id,
          filename: filename.value,
          r2Key,
          mime: file.type,
          bytes: file.size,
        });
      } catch {
        // 同じ名前が既にある。R2 は上書きしてしまっているので、DB の側を正とする。
        return c.json(...apiError('filename-taken', filename.value));
      }

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
      return c.json({ deleted: media.public_id });
    })

    /**
     * `body_html` は派生データなので、renderer を更新したら作り直す。
     * 下書きも含めて全部。
     */
    .post('/rerender', async (c) => {
      const db = c.env.DB;
      const posts = await listAllPosts(db, { limit: 1000 });
      const warnings: { publicId: string; unresolvedMedia: readonly string[] }[] = [];

      for (const post of posts) {
        const unresolved = await renderAndStore(db, post);
        if (unresolved.length > 0) {
          warnings.push({ publicId: post.public_id, unresolvedMedia: unresolved });
        }
      }
      return c.json({ rendered: posts.length, warnings });
    });
}

export type LilyApi = ReturnType<typeof createApi>;

/** タグの付け替え。渡されなければ触らない。 */
async function applyTags(
  db: D1Database,
  postId: number,
  tags: string[] | undefined,
): Promise<ReturnType<typeof apiError> | null> {
  if (!tags) return null;
  const result = await setPostTags(db, postId, tags);
  return result.ok ? null : apiError(result.error.code, result.error.name);
}

/** 記事を保存したあとの応答。**保存のたびに描き直す**ので、配信側は常に最新を持つ。 */
async function detail(db: D1Database, urls: Urls, post: PostRow) {
  const unresolvedMedia = await renderAndStore(db, post);
  const fresh = (await getPostByPublicId(db, post.public_id)) ?? post;
  return { post: await toPostView(db, urls, fresh), unresolvedMedia };
}
