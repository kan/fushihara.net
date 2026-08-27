import { beforeEach, describe, expect, it } from 'vitest';
import { addAlias } from '../../src/core/db/post-paths.ts';
import { updatePost } from '../../src/core/db/posts.ts';
import { createMedia } from '../../src/core/db/media.ts';
import { hashPreviewToken, newPreviewToken } from '../../src/core/tokens.ts';
import { db, resetDb } from '../db/helpers.ts';
import { get, getRoot, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

describe('一覧', () => {
  it('公開記事が出て、下書きは出ない', async () => {
    await seedPost({ title: '公開した記事', path: 'shown' });
    await seedPost({ title: '下書きの記事', path: 'hidden', draft: true });

    const res = await get('/blog/');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('公開した記事');
    expect(body).toContain('href="/blog/shown/"');
    expect(body).not.toContain('下書きの記事');
  });

  it('新しい順に並ぶ', async () => {
    await seedPost({ title: '古い', path: 'old', publishedAt: '2026-01-01T00:00:00.000Z' });
    await seedPost({ title: '新しい', path: 'new', publishedAt: '2026-08-01T00:00:00.000Z' });

    const body = await get('/blog/');
    const text = await body.text();
    expect(text.indexOf('新しい')).toBeLessThan(text.indexOf('古い'));
  });

  it('記事が無くてもページは出る', async () => {
    const res = await get('/blog/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('まだ記事がありません');
  });

  it('マウント直下のスラッシュ無しは 308 で寄せる', async () => {
    const res = await get('/blog');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/');
  });
});

describe('記事', () => {
  it('canonical path で開ける', async () => {
    await seedPost({ title: 'はじめての記事', path: 'start-blog', tags: ['dev'] });

    const res = await get('/blog/start-blog/');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('<h1 class="post-title">はじめての記事</h1>');
    expect(body).toContain('<h2>見出し</h2>');
    expect(body).toContain(`<link rel="canonical" href="${SITE}/blog/start-blog/" />`);
    expect(body).toContain('href="/blog/tags/dev/"');
  });

  it('末尾スラッシュ無しは 308 で寄せる', async () => {
    await seedPost({ path: 'start-blog' });
    const res = await get('/blog/start-blog');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/start-blog/');
  });

  it('alias は canonical へ 308', async () => {
    const post = await seedPost({ path: 'now' });
    await addAlias(db, post.id, 'then');

    const res = await get('/blog/then/');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/now/');
  });

  it('public_id でも辿り着ける (identity は URL から独立)', async () => {
    const post = await seedPost({ path: 'now' });
    const res = await get(`/blog/${post.public_id}/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/now/');
  });

  it('大小文字違いも canonical へ 308', async () => {
    await seedPost({ path: 'Start-Blog' });
    const res = await get('/blog/start-blog/');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/Start-Blog/');
  });

  it('308 の飛び先はもう 308 しない', async () => {
    await seedPost({ path: 'now' });
    const first = await get('/blog/now');
    const second = await get(first.headers.get('location')!);
    expect(second.status).toBe(200);
  });

  it('下書きは 404。パスを当てられても 308 で存在が漏れない', async () => {
    await seedPost({ path: 'secret', draft: true });
    expect((await get('/blog/secret/')).status).toBe(404);
    // 末尾スラッシュ無しでも 308 ではなく 404
    expect((await get('/blog/secret')).status).toBe(404);
  });

  it('body_html が無ければ body_md から描画する', async () => {
    await seedPost({ path: 'fresh', bodyMd: '## あとから描画\n', skipRender: true });
    const body = await (await get('/blog/fresh/')).text();
    expect(body).toContain('<h2>あとから描画</h2>');
  });

  it('本文の相対参照が配信 URL に解決される', async () => {
    const post = await seedPost({
      path: 'with-image',
      bodyMd: '![図](./sample.png)\n',
      skipRender: true,
    });
    const media = await createMedia(db, {
      postId: post.id,
      filename: 'sample.png',
      r2Key: 'posts/with-image/sample.png',
      mime: 'image/png',
      bytes: 10,
    });

    const body = await (await get('/blog/with-image/')).text();
    expect(body).toContain(`src="/blog/media/${media.public_id}/sample.png"`);
    expect(body).not.toContain('lily-media://');
  });
});

describe('タグ', () => {
  it('そのタグの公開記事だけが出る', async () => {
    await seedPost({ title: '開発の記事', path: 'a', tags: ['dev'] });
    await seedPost({ title: '日常の記事', path: 'b', tags: ['life'] });

    const body = await (await get('/blog/tags/dev/')).text();
    expect(body).toContain('開発の記事');
    expect(body).not.toContain('日常の記事');
  });

  it('末尾スラッシュ無しは 308 で寄せる', async () => {
    const res = await get('/blog/tags/dev');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/blog/tags/dev/');
  });

  it('知らないタグは 404', async () => {
    expect((await get('/blog/tags/nope/')).status).toBe(404);
  });
});

describe('404', () => {
  it('知らないパスは 404 ページ', async () => {
    const res = await get('/blog/no-such-post/');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<h1>404</h1>');
  });

  it('canonical と og:url を出さず noindex にする', async () => {
    const body = await (await get('/blog/no-such-post/')).text();
    expect(body).toContain('<meta name="robots" content="noindex" />');
    expect(body).not.toContain('rel="canonical"');
    expect(body).not.toContain('og:url');
  });

  it('予約パスに記事は無いので 404', async () => {
    expect((await get('/blog/admin/')).status).toBe(404);
    expect((await get('/blog/api/posts')).status).toBe(404);
  });

  it('マウントの外も 404', async () => {
    expect((await get('/blogfoo')).status).toBe(404);
  });
});

describe('下書きプレビュー', () => {
  async function withPreviewToken(): Promise<string> {
    const post = await seedPost({ path: 'draft-post', draft: true, title: '下書きの記事' });
    const token = newPreviewToken();
    await updatePost(db, post.id, { preview_token_hash: await hashPreviewToken(token) });
    return token;
  }

  it('トークンがあれば下書きが読める', async () => {
    const res = await get(`/blog/preview/${await withPreviewToken()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('下書きの記事');
  });

  it('残らないようにして、検索にも載せない', async () => {
    const res = await get(`/blog/preview/${await withPreviewToken()}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
  });

  it('知らないトークンは 404', async () => {
    expect((await get('/blog/preview/nope')).status).toBe(404);
  });
});

describe('スタイルシート', () => {
  it('トークンとブログの CSS を 1 本にして配る', async () => {
    const res = await get('/blog/styles.css');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(res.headers.get('etag')).toBeTruthy();
    // shared/tokens.css 側
    expect(body).toContain('--bg:');
    // blog.css 側
    expect(body).toContain('.prose pre.shiki');
  });
});

describe('mountPath', () => {
  it('root mount でも同じコアで成立する', async () => {
    await seedPost({ path: 'start-blog', title: 'ルートの記事' });

    const index = await getRoot('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('href="/start-blog/"');

    const post = await getRoot('/start-blog/');
    expect(post.status).toBe(200);
    expect(await post.text()).toContain('ルートの記事');

    const redirect = await getRoot('/start-blog');
    expect(redirect.headers.get('location')).toBe('/start-blog/');
  });
});

describe('キャッシュ', () => {
  it('エッジには 60 秒載せ、ブラウザには毎回確認させる', async () => {
    await seedPost({ path: 'start-blog' });
    for (const path of ['/blog/', '/blog/start-blog/']) {
      const res = await get(path);
      expect(res.headers.get('cache-control'), path).toBe(
        'public, max-age=0, must-revalidate, s-maxage=60',
      );
    }
  });
});
