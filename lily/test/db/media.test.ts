import { beforeEach, expect, it } from 'vitest';
import { createPost } from '../../src/core/db/posts.ts';
import {
  createMedia,
  deleteMedia,
  findByPostAndFilename,
  getMediaByPublicId,
  listMediaByPost,
} from '../../src/core/db/media.ts';
import { db, resetDb } from './helpers.ts';

beforeEach(resetDb);

async function createPostId(path: string): Promise<number> {
  const result = await createPost(db, { title: path, bodyMd: 'x', path });
  if (!result.ok) throw new Error(`createPost に失敗した: ${result.error.code}`);
  return result.value.id;
}

it('本文の相対参照は (post_id, filename) で引ける', async () => {
  const postId = await createPostId('a');
  const media = await createMedia(db, {
    postId,
    filename: 'sample.png',
    r2Key: 'posts/a/sample.png',
    mime: 'image/png',
    bytes: 123,
    width: 640,
    height: 480,
  });

  expect(await findByPostAndFilename(db, postId, 'sample.png')).toMatchObject({
    public_id: media.public_id,
    r2_key: 'posts/a/sample.png',
    width: 640,
  });
  expect(await findByPostAndFilename(db, postId, 'nope.png')).toBeNull();
  expect((await getMediaByPublicId(db, media.public_id))?.id).toBe(media.id);
});

it('記事ごとに一覧できる', async () => {
  const postId = await createPostId('a');
  for (const filename of ['b.png', 'a.png']) {
    await createMedia(db, {
      postId,
      filename,
      r2Key: `posts/a/${filename}`,
      mime: 'image/png',
      bytes: 1,
    });
  }
  expect((await listMediaByPost(db, postId)).map((m) => m.filename)).toEqual(['a.png', 'b.png']);
});

it('消すと R2 のキーを返す', async () => {
  const postId = await createPostId('a');
  const media = await createMedia(db, {
    postId,
    filename: 'sample.png',
    r2Key: 'posts/a/sample.png',
    mime: 'image/png',
    bytes: 1,
  });
  expect(await deleteMedia(db, media.id)).toBe('posts/a/sample.png');
  expect(await getMediaByPublicId(db, media.public_id)).toBeNull();
  expect(await deleteMedia(db, media.id)).toBeNull();
});
