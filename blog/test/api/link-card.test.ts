import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMediaByPosts } from '../../src/core/db/media.ts';
import { getPostByPublicId } from '../../src/core/db/posts.ts';
import { db, resetDb } from '../db/helpers.ts';
import { apiJson, setStubUser } from '../routes/helpers.ts';
import { pngHeader } from '../fixtures/png.ts';

/**
 * 貼った URL をカードにする口。**外へは一切出さない** (`fetch` を差し替える)。
 *
 * 見ているのは「相手のページを読む」ところではなく (それは `link-preview.test.ts`)、
 * **取ってきた絵を添付として取り込む**ところ。
 */

const PAGE = 'https://example.com/article';
const IMAGE = 'https://cdn.example.com/og.png';

const THUMBNAIL = pngHeader(1200, 630);

/** 何を取りに行ったか。**内側を指す og:image を叩いていないこと**を見るのに使う。 */
let requested: string[] = [];

function stubSite(options: { image?: string | null; imageMime?: string; imageBytes?: Uint8Array } = {}) {
  const image = options.image === undefined ? IMAGE : options.image;

  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);

    if (url === PAGE) {
      const meta = image === null ? '' : `<meta property="og:image" content="${image}">`;
      return new Response(
        `<html><head><title>相手の題</title>
         <meta property="og:description" content="相手の説明">
         <meta property="og:site_name" content="Example">
         ${meta}</head><body>x</body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    return new Response(options.imageBytes ?? THUMBNAIL, {
      headers: { 'Content-Type': options.imageMime ?? 'image/png' },
    });
  });
}

beforeEach(async () => {
  await resetDb();
  requested = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  setStubUser(null);
});

async function createPost() {
  const { status, body } = await apiJson('POST', '/api/posts', {
    title: 'カードを貼る記事',
    bodyMd: '本文。\n',
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.post as { publicId: string };
}

async function makeCard(publicId: string, url = PAGE) {
  return await apiJson('POST', `/api/posts/${publicId}/link-card`, { url });
}

describe('カードを組む', () => {
  it('題・説明・出典と、添付にしたサムネが入る', async () => {
    stubSite();
    const post = await createPost();

    const { status, body } = await makeCard(post.publicId);
    expect(status, JSON.stringify(body)).toBe(200);

    expect(body.html).toContain('class="link-card"');
    expect(body.html).toContain(`href="${PAGE}"`);
    expect(body.html).toContain('相手の題');
    expect(body.html).toContain('相手の説明');
    expect(body.html).toContain('Example');
    // **本文に入るのは相対参照。** 配信 URL は描画時に解決する。
    expect(body.html).toContain(`src="./${body.media.filename}"`);
    expect(body.html).not.toContain(IMAGE);
    // 寸法は生 HTML には自動で付かないので、ここで書いておく必要がある。
    expect(body.html).toContain('width="1200" height="630"');
  });

  it('サムネが記事の添付として登録され、R2 に実体が乗る', async () => {
    stubSite();
    const post = await createPost();
    const { body } = await makeCard(post.publicId);

    const row = await getPostByPublicId(db, post.publicId);
    const media = await listMediaByPosts(db, [row!.id]);
    expect(media.map((m) => m.filename)).toEqual([body.media.filename]);
    expect(media[0]?.width).toBe(1200);
    expect(media[0]?.height).toBe(630);

    const stored = await env.MEDIA.get(media[0]!.r2_key);
    expect(stored).not.toBeNull();
    expect((await stored!.arrayBuffer()).byteLength).toBe(THUMBNAIL.byteLength);
  });

  it('同じ URL を 2 回貼っても添付は増えない', async () => {
    // ファイル名をページの URL から決めているので、2 回目は既にあるものを使う。
    stubSite();
    const post = await createPost();

    const first = await makeCard(post.publicId);
    const second = await makeCard(post.publicId);
    expect(second.body.media.filename).toBe(first.body.media.filename);

    const row = await getPostByPublicId(db, post.publicId);
    expect(await listMediaByPosts(db, [row!.id])).toHaveLength(1);
  });

  it('Content-Type が大文字でも表と突き合う', async () => {
    // ヘッダは大小を区別しない。そのまま保存すると imageDimensions も canBeOgp も
    // 表に無い値として外し、export → import で拡張子から引き直した値と食い違う。
    stubSite({ imageMime: 'IMAGE/PNG' });
    const post = await createPost();
    const { body } = await makeCard(post.publicId);

    expect(body.media.mime).toBe('image/png');
    expect(body.html).toContain('width="1200" height="630"');
  });

  it('ファイル名に相手の host が入る', async () => {
    stubSite();
    const post = await createPost();
    const { body } = await makeCard(post.publicId);
    expect(body.media.filename).toMatch(/^card-example-com-[0-9a-f]{8}\.png$/);
  });
});

describe('絵が取れないとき', () => {
  async function cardWithoutImage(stub: () => void) {
    stub();
    const post = await createPost();
    const { status, body } = await makeCard(post.publicId);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.media).toBeNull();
    expect(body.html).not.toContain('<img');
    return body;
  }

  it('og:image が無くてもカードは作る', async () => {
    const body = await cardWithoutImage(() => stubSite({ image: null }));
    expect(body.html).toContain('相手の題');
  });

  it('SVG は添付にしない', async () => {
    // よそから取ってきた SVG はスクリプトを持てる。カードは画像なしで出す。
    await cardWithoutImage(() => stubSite({ imageMime: 'image/svg+xml' }));
  });

  it('大きすぎる絵は諦める', async () => {
    await cardWithoutImage(() => stubSite({ imageBytes: new Uint8Array(5 * 1024 * 1024) }));
  });

  it('内側を指す og:image は取りに行かない', async () => {
    // 相手のページが書いた URL をそのまま fetch する経路なので、ここも同じ関門を通す。
    await cardWithoutImage(() => stubSite({ image: 'http://169.254.169.254/latest/meta-data/' }));
    expect(requested).toEqual([PAGE]);
  });
});

describe('カードにできないとき', () => {
  it('相手が読めなければ 502（テキストリンクのままにできるように）', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('つながらない');
    });
    const post = await createPost();
    const { status, body } = await makeCard(post.publicId);
    expect(status).toBe(502);
    expect(body.error).toBe('link-unreachable');
  });

  it('無い記事なら 404', async () => {
    stubSite();
    const { status } = await makeCard('00000000-0000-4000-8000-000000000000');
    expect(status).toBe(404);
  });

  it('URL の形をしていなければ 400', async () => {
    stubSite();
    const post = await createPost();
    expect((await makeCard(post.publicId, 'ただのメモ')).status).toBe(400);
  });
});
