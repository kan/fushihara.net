import { beforeEach, describe, expect, it } from 'vitest';
import {
  countPublishedPosts,
  createPost,
  deletePost,
  getPostByPreviewTokenHash,
  getPublishedPosts,
  listAllPosts,
  setRenderedHtml,
  updatePost,
} from '../../src/core/db/posts.ts';
import { listPaths } from '../../src/core/db/post-paths.ts';
import { createMedia } from '../../src/core/db/media.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { db, resetDb } from './helpers.ts';

beforeEach(resetDb);

async function create(input: Parameters<typeof createPost>[1]): Promise<PostRow> {
  const result = await createPost(db, input);
  if (!result.ok) throw new Error(`createPost に失敗した: ${result.error.code}`);
  return result.value;
}

describe('createPost', () => {
  it('既定は下書きで、canonical path は public_id', async () => {
    const post = await create({ title: 'はじめて', bodyMd: '本文' });
    expect(post.status).toBe('draft');
    expect(post.published_at).toBeNull();

    const paths = await listPaths(db, post.id);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ path: post.public_id, is_canonical: 1 });
  });

  it('canonical を指定しても public_id で引ける (identity は URL から独立)', async () => {
    const post = await create({ title: 'x', bodyMd: 'y', path: 'ratatoskr/1' });
    const paths = await listPaths(db, post.id);
    expect(paths.map((p) => p.path).sort()).toEqual([post.public_id, 'ratatoskr/1'].sort());
    expect(paths.find((p) => p.is_canonical === 1)?.path).toBe('ratatoskr/1');
  });

  it('使われているパスは大小文字違いでも拒否する', async () => {
    await create({ title: 'x', bodyMd: 'y', path: 'taken' });
    const result = await createPost(db, { title: 'z', bodyMd: 'w', path: 'TAKEN' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-taken');
  });

  it('予約パスは canonical にできない', async () => {
    const result = await createPost(db, { title: 'x', bodyMd: 'y', path: 'admin' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('reserved-path');
  });

  it('公開で作ると published_at が入る (CHECK に弾かれない)', async () => {
    const post = await create({ title: 'x', bodyMd: 'y', status: 'published' });
    expect(post.published_at).not.toBeNull();
  });

  it('import 用に public_id と日時を引き継げる', async () => {
    const post = await create({
      title: 'x',
      bodyMd: 'y',
      publicId: '11111111-2222-3333-4444-555555555555',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
    });
    expect(post.public_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(post.created_at).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('一覧', () => {
  async function publish(path: string, publishedAt: string, publicId?: string): Promise<PostRow> {
    return await create({
      title: path,
      bodyMd: '本文',
      path,
      status: 'published',
      publishedAt,
      publicId,
    });
  }

  it('新しい順に並ぶ', async () => {
    await publish('old', '2026-01-01T00:00:00.000Z');
    await publish('new', '2026-08-01T00:00:00.000Z');
    await publish('mid', '2026-05-01T00:00:00.000Z');
    const posts = await getPublishedPosts(db);
    expect(posts.map((p) => p.canonical_path)).toEqual(['new', 'mid', 'old']);
  });

  it('同時刻は public_id の昇順で安定させる (id の振り直しに影響されない)', async () => {
    const at = '2026-03-03T00:00:00.000Z';
    // 挿入順と public_id の順を逆にして、id 順ではないことを見る
    await publish('b', at, 'bbbbbbbb-0000-4000-8000-000000000000');
    await publish('a', at, 'aaaaaaaa-0000-4000-8000-000000000000');
    const posts = await getPublishedPosts(db);
    expect(posts.map((p) => p.canonical_path)).toEqual(['a', 'b']);
  });

  it('下書きは出ない', async () => {
    await publish('shown', '2026-01-01T00:00:00.000Z');
    await create({ title: 'draft', bodyMd: 'x', path: 'hidden' });
    expect((await getPublishedPosts(db)).map((p) => p.canonical_path)).toEqual(['shown']);
    expect(await countPublishedPosts(db)).toBe(1);
    expect((await listAllPosts(db)).map((p) => p.canonical_path).sort()).toEqual(['hidden', 'shown']);
  });

  it('limit と offset が効く', async () => {
    await publish('1', '2026-01-01T00:00:00.000Z');
    await publish('2', '2026-02-01T00:00:00.000Z');
    await publish('3', '2026-03-01T00:00:00.000Z');
    expect((await getPublishedPosts(db, { limit: 2 })).map((p) => p.canonical_path)).toEqual(['3', '2']);
    expect((await getPublishedPosts(db, { limit: 2, offset: 2 })).map((p) => p.canonical_path)).toEqual(['1']);
  });
});

describe('更新と削除', () => {
  it('updatePost は updated_at を進める', async () => {
    const post = await create({ title: 'x', bodyMd: 'y', updatedAt: '2020-01-01T00:00:00.000Z' });
    const updated = await updatePost(db, post.id, { title: '新しい題' });
    expect(updated?.title).toBe('新しい題');
    expect(updated?.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('status だけ published にしても published_at が補われる (公開ボタンの呼び方)', async () => {
    const post = await create({ title: 'x', bodyMd: 'y' });
    const published = await updatePost(db, post.id, { status: 'published' });
    expect(published?.status).toBe('published');
    expect(published?.published_at).not.toBeNull();
  });

  it('再公開しても元の公開日は変わらない', async () => {
    const post = await create({
      title: 'x',
      bodyMd: 'y',
      status: 'published',
      publishedAt: '2026-01-01T00:00:00.000Z',
    });
    await updatePost(db, post.id, { status: 'draft' });
    const republished = await updatePost(db, post.id, { status: 'published' });
    expect(republished?.published_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('setRenderedHtml は body_html と renderer_version を一緒に入れる', async () => {
    const post = await create({ title: 'x', bodyMd: 'y' });
    await setRenderedHtml(db, post.id, '<p>y</p>', 'r1');
    const row = await db
      .prepare('SELECT body_html, renderer_version FROM posts WHERE id = ?1')
      .bind(post.id)
      .first<{ body_html: string; renderer_version: string }>();
    expect(row).toEqual({ body_html: '<p>y</p>', renderer_version: 'r1' });
  });

  it('プレビューはハッシュで引ける', async () => {
    const post = await create({ title: 'x', bodyMd: 'y' });
    await updatePost(db, post.id, { preview_token_hash: 'deadbeef' });
    expect((await getPostByPreviewTokenHash(db, 'deadbeef'))?.id).toBe(post.id);
    await updatePost(db, post.id, { preview_token_hash: null });
    expect(await getPostByPreviewTokenHash(db, 'deadbeef')).toBeNull();
  });

  it('deletePost は R2 のキーを返し、関連行は CASCADE で消える', async () => {
    const post = await create({ title: 'x', bodyMd: 'y', path: 'gone' });
    await createMedia(db, {
      postId: post.id,
      filename: 'sample.png',
      r2Key: 'posts/gone/sample.png',
      mime: 'image/png',
      bytes: 10,
    });

    expect(await deletePost(db, post.id)).toEqual(['posts/gone/sample.png']);
    expect(await listPaths(db, post.id)).toEqual([]);
    const media = await db
      .prepare('SELECT count(*) AS n FROM media WHERE post_id = ?1')
      .bind(post.id)
      .first<{ n: number }>();
    expect(media?.n).toBe(0);
  });
});
