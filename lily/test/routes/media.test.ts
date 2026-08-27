import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMedia } from '../../src/core/db/media.ts';
import { db, resetDb } from '../db/helpers.ts';
import { get, seedPost } from './helpers.ts';

beforeEach(resetDb);

describe('添付', () => {
  async function seedMedia(filename = 'sample.png') {
    const post = await seedPost({ path: 'with-image' });
    const media = await createMedia(db, {
      postId: post.id,
      filename,
      r2Key: `posts/with-image/${filename}`,
      mime: 'image/png',
      bytes: 3,
    });
    await env.MEDIA.put(media.r2_key, 'png');
    return media;
  }

  it('URL は不変なので長期キャッシュする', async () => {
    const media = await seedMedia();
    const res = await get(`/blog/media/${media.public_id}/sample.png`);
    // 差し替えは行ごと作り直す = public_id が変わるので、URL は不変
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('ファイル名が違えば返さない (URL と中身を食い違わせない)', async () => {
    const media = await seedMedia();
    expect((await get(`/blog/media/${media.public_id}/other.png`)).status).toBe(404);
  });

  it('知らない id と、R2 に実体が無いものは 404', async () => {
    const post = await seedPost({ path: 'gone' });
    const orphan = await createMedia(db, {
      postId: post.id,
      filename: 'missing.png',
      r2Key: 'posts/gone/missing.png',
      mime: 'image/png',
      bytes: 1,
    });
    expect((await get('/blog/media/nope/x.png')).status).toBe(404);
    expect((await get(`/blog/media/${orphan.public_id}/missing.png`)).status).toBe(404);
  });
});
