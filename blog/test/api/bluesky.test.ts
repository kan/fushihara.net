import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPostByPublicId } from '../../src/core/db/posts.ts';
import { db, resetDb } from '../db/helpers.ts';
import {
  AT_URI,
  resetXrpcCalls,
  sentRecord,
  stubBluesky,
  xrpcCalls,
} from '../fixtures/bluesky.ts';
import { apiJson, ROOT_LANG, seedPost, setStubBluesky, setStubUser } from '../routes/helpers.ts';

/**
 * 告知の口。**上流は必ずスタブで止める**（`fixtures/bluesky.ts`）。
 *
 * ここで見たいのは XRPC の中身（それは `test/bluesky.test.ts`）ではなく、
 * 押せる条件・二重投稿の抑止・失敗したときに何が DB に残るか。
 */

beforeEach(async () => {
  await resetDb();
  setStubBluesky({ identifier: 'someone.example', appPassword: 'app-pw' });
  stubBluesky();
});

afterEach(() => {
  setStubUser(null);
  setStubBluesky(null);
  vi.unstubAllGlobals();
});

function announce(publicId: string) {
  return apiJson('POST', `/api/posts/${publicId}/bluesky`);
}

describe('告知する', () => {
  it('AT-URI を記録し、開ける URL を返す', async () => {
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.post.blueskyUri).toBe(AT_URI);
    expect(body.post.blueskyUrl).toBe('https://bsky.app/profile/did:plc:abc/post/3kxyz');
    expect((await getPostByPublicId(db, post.public_id))?.bluesky_uri).toBe(AT_URI);
  });

  it('updated_at を動かさない（購読者のリーダーに記事を浮き上がらせない）', async () => {
    const post = await seedPost();
    const before = post.updated_at;
    await announce(post.public_id);
    expect((await getPostByPublicId(db, post.public_id))?.updated_at).toBe(before);
  });

  it('リンクカードには記事の URL と説明が入り、サムネは配信中の ogp.png', async () => {
    const post = await seedPost({ path: 'start-blog', description: 'ためしに書いた' });
    await announce(post.public_id);

    const record = sentRecord();
    expect(record.embed.external).toMatchObject({
      // root mount のテストアプリなので `/start-blog/`。
      uri: 'https://blog.example.com/start-blog/',
      title: 'はじめての記事',
      description: 'ためしに書いた',
    });
    // 実体は ASSETS バインディング（dist/ogp.png）から読む。**外向きの fetch では
    // 取りに行かない**（自分のゾーンへサブリクエストを出さない）。
    expect(record.embed.external.thumb).toBeDefined();
    expect(xrpcCalls().some((call) => call.url.includes('/ogp.png'))).toBe(false);

    // 言語はサイト設定から。core は既定値を持たない。
    expect(record.langs).toEqual([ROOT_LANG]);
  });

  it('説明を書いていなければ本文の冒頭が入る', async () => {
    const post = await seedPost({ description: null, bodyMd: '最初の段落。\n\n次の段落。\n' });
    await announce(post.public_id);
    expect(sentRecord().embed.external.description).toBe('最初の段落。');
  });
});

describe('押せないとき', () => {
  it('下書きは告知できない（読者には 404 なのでカードが組めない）', async () => {
    const post = await seedPost({ draft: true });
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(400);
    expect(body.error).toBe('post-not-published');
    expect(xrpcCalls()).toEqual([]);
  });

  it('2 回目は 409（二重投稿の抑止）', async () => {
    const post = await seedPost();
    expect((await announce(post.public_id)).status).toBe(200);

    resetXrpcCalls();
    const { status, body } = await announce(post.public_id);
    expect(status).toBe(409);
    expect(body.error).toBe('already-announced');
    expect(body.message).toBe(AT_URI);
    // **投げてから気付くのでは遅い。**
    expect(xrpcCalls()).toEqual([]);
  });

  it('資格情報が無ければ 400 で、上流も叩かない', async () => {
    setStubBluesky(null);
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(400);
    expect(body.error).toBe('bluesky-not-configured');
    expect(xrpcCalls()).toEqual([]);
  });

  it('無い記事は 404', async () => {
    expect((await announce('missing')).status).toBe(404);
  });
});

describe('上流が失敗したとき', () => {
  it('502 を返し、告知済みにはしない（直したら押し直せる）', async () => {
    stubBluesky({
      'com.atproto.server.createSession': () =>
        Response.json({ error: 'AuthenticationRequired' }, { status: 401 }),
    });
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(502);
    expect(body.error).toBe('bluesky-failed');
    expect(body.message).toContain('AuthenticationRequired');
    expect((await getPostByPublicId(db, post.public_id))?.bluesky_uri).toBeNull();
  });
});
