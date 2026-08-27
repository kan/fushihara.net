import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPostByPublicId } from '../../src/core/db/posts.ts';
import { resolvePath } from '../../src/core/db/post-paths.ts';
import { db, resetDb } from '../db/helpers.ts';
import { api, apiJson, getRoot, json, setStubUser } from '../routes/helpers.ts';

beforeEach(resetDb);
afterEach(() => setStubUser(null));

async function createPost(body: Record<string, unknown> = {}) {
  const { status, body: created } = await apiJson('POST', '/api/posts', {
    title: 'はじめての記事',
    bodyMd: '## 見出し\n\n本文。\n',
    ...body,
  });
  expect(status, JSON.stringify(created)).toBe(201);
  return created.post;
}

describe('認証', () => {
  it('未認証では触れない', async () => {
    setStubUser(null);
    expect((await getRoot('/api/posts')).status).toBe(403);
  });
});

describe('作成と取得', () => {
  it('作ると下書きで、canonical は public_id', async () => {
    const post = await createPost();
    expect(post.status).toBe('draft');
    expect(post.canonicalPath).toBe(post.publicId);
    expect(post.url).toBe(`/${post.publicId}/`);
  });

  it('保存した時点で配信用の HTML も作る', async () => {
    // body_html は派生データだが、配信側が毎回描き直さずに済むよう保存のたびに作る。
    const post = await createPost();
    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>見出し</h2>');
    expect(row?.renderer_version).not.toBeNull();
  });

  it('パスとタグを指定できる', async () => {
    const post = await createPost({ path: 'start-blog', tags: ['dev', '日記'] });
    expect(post.canonicalPath).toBe('start-blog');
    expect(post.tags.map((t: { name: string }) => t.name).sort()).toEqual(['dev', '日記']);
    // public_id でも引けるよう alias が入る
    expect(post.paths.map((p: { path: string }) => p.path).sort()).toEqual(
      [post.publicId, 'start-blog'].sort(),
    );
  });

  it('プレビューのトークンは外に出さない', async () => {
    const post = await createPost();
    expect(JSON.stringify(post)).not.toContain('preview_token_hash');
    expect(post.hasPreview).toBe(false);
  });

  it('一覧と個別取得', async () => {
    const post = await createPost({ path: 'a' });
    const list = await apiJson('GET', '/api/posts');
    expect(list.body.posts.map((p: { publicId: string }) => p.publicId)).toEqual([post.publicId]);

    const one = await apiJson('GET', `/api/posts/${post.publicId}`);
    expect(one.body.post.title).toBe('はじめての記事');
    expect((await apiJson('GET', '/api/posts/nope')).status).toBe(404);
  });

  it('形が違う入力は 400', async () => {
    expect((await apiJson('POST', '/api/posts', { title: '' })).status).toBe(400);
    expect((await apiJson('POST', '/api/posts', {})).status).toBe(400);
  });

  it('使われているパスは 409', async () => {
    await createPost({ path: 'taken' });
    const conflict = await apiJson('POST', '/api/posts', { title: 'x', path: 'TAKEN' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('path-taken');
  });

  it('予約パスは 400', async () => {
    const reserved = await apiJson('POST', '/api/posts', { title: 'x', path: 'admin' });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error).toBe('reserved-path');
  });
});

describe('更新', () => {
  it('本文を書き換えると配信用の HTML も描き直す', async () => {
    const post = await createPost();
    await apiJson('PATCH', `/api/posts/${post.publicId}`, { bodyMd: '## 書き直した\n' });

    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>書き直した</h2>');
    expect(row?.body_html).not.toContain('見出し</h2>');
  });

  it('タグを丸ごと置き換える', async () => {
    const post = await createPost({ tags: ['a', 'b'] });
    const updated = await apiJson('PATCH', `/api/posts/${post.publicId}`, { tags: ['b', 'c'] });
    expect(updated.body.post.tags.map((t: { name: string }) => t.name)).toEqual(['b', 'c']);
  });

  it('slug が衝突するタグは 409', async () => {
    const post = await createPost();
    const conflict = await apiJson('PATCH', `/api/posts/${post.publicId}`, { tags: ['Dev', 'dev'] });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('slug-taken');
  });
});

describe('公開と取り下げ', () => {
  it('公開すると published_at が入り、取り下げても日付は残る', async () => {
    const post = await createPost({ path: 'a' });
    const published = await apiJson('POST', `/api/posts/${post.publicId}/publish`, {
      publishedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(published.body.post.status).toBe('published');
    expect(published.body.post.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((await getRoot('/a/')).status).toBe(200);

    const draft = await apiJson('POST', `/api/posts/${post.publicId}/unpublish`);
    expect(draft.body.post.status).toBe('draft');
    expect(draft.body.post.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((await getRoot('/a/')).status).toBe(404);
  });

  it('日付を省いても公開できる', async () => {
    const post = await createPost();
    const published = await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});
    expect(published.body.post.publishedAt).not.toBeNull();
  });
});

describe('パスの操作', () => {
  it('canonical を変えると旧パスは alias として残る', async () => {
    const post = await createPost({ path: 'old' });
    await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});

    const changed = await apiJson('PUT', `/api/posts/${post.publicId}/path`, { path: 'new' });
    expect(changed.body.post.canonicalPath).toBe('new');

    // 共有された URL は生き続ける
    const redirect = await getRoot('/old/');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/new/');
  });

  it('alias を足して消せる。canonical と public_id は消せない', async () => {
    const post = await createPost({ path: 'a' });
    await apiJson('POST', `/api/posts/${post.publicId}/paths`, { path: 'b' });
    expect(await resolvePath(db, 'b')).not.toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: 'b' })).status).toBe(200);
    expect(await resolvePath(db, 'b')).toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: 'a' })).body.error)
      .toBe('canonical-required');
    expect(
      (await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: post.publicId })).body.error,
    ).toBe('public-id-path');
  });

  it('他の記事のパスは取れない', async () => {
    await createPost({ path: 'a' });
    const other = await createPost({ path: 'b', title: 'ほか' });
    const conflict = await apiJson('PUT', `/api/posts/${other.publicId}/path`, { path: 'a' });
    expect(conflict.status).toBe(409);
  });
});

describe('下書きプレビュー', () => {
  it('発行した URL で下書きが読め、失効させると 404', async () => {
    const post = await createPost({ title: '下書きの記事' });
    const issued = await apiJson('POST', `/api/posts/${post.publicId}/preview`);
    const path = new URL(issued.body.url).pathname;

    const preview = await getRoot(path);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('下書きの記事');

    expect((await apiJson('GET', `/api/posts/${post.publicId}`)).body.post.hasPreview).toBe(true);

    await apiJson('DELETE', `/api/posts/${post.publicId}/preview`);
    expect((await getRoot(path)).status).toBe(404);
  });

  it('生のトークンを返すのは発行のときだけ', async () => {
    const post = await createPost();
    const issued = await apiJson('POST', `/api/posts/${post.publicId}/preview`);
    const token = new URL(issued.body.url).pathname.split('/').pop();

    const detail = await apiJson('GET', `/api/posts/${post.publicId}`);
    expect(JSON.stringify(detail.body)).not.toContain(token);
  });
});

describe('削除', () => {
  it('記事を消すと R2 の実体も消える', async () => {
    const post = await createPost();
    await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });

    const key = `posts/${post.publicId}/sample.png`;
    expect(await env.MEDIA.get(key)).not.toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}`)).status).toBe(200);
    expect(await getPostByPublicId(db, post.publicId)).toBeNull();
    expect(await env.MEDIA.get(key)).toBeNull();
  });
});

function filePayload(name = 'sample.png', type = 'image/png', bytes = 'png'): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return form;
}

describe('添付', () => {
  it('上げると本文の相対参照が解決される', async () => {
    const post = await createPost({ bodyMd: '![図](./sample.png)\n' });
    const before = await getPostByPublicId(db, post.publicId);
    expect(before?.body_html).toContain('src="./sample.png"');

    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect(res.status).toBe(201);
    const uploaded = await json(res);
    expect(uploaded.media.url).toBe(`/media/${uploaded.media.publicId}/sample.png`);

    // 上げた時点で描き直すので、配信側は placeholder 済みの HTML を持つ
    const after = await getPostByPublicId(db, post.publicId);
    expect(after?.body_html).toContain('lily-media://');
    expect((await getRoot(uploaded.media.url)).status).toBe(200);
  });

  it('解決できない参照を警告として返す', async () => {
    const post = await createPost({ bodyMd: '![図](./missing.png)\n' });
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect((await json(res)).unresolvedMedia).toEqual(['./missing.png']);
  });

  it('許していない形式は弾く', async () => {
    const post = await createPost();
    const res = await api(`/api/posts/${post.publicId}/media`, {
      method: 'POST',
      body: filePayload('evil.html', 'text/html', '<script>'),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('mime-not-allowed');
  });

  it('記事のパスと同じ規則でファイル名を見る', async () => {
    const post = await createPost();
    for (const name of ['a/b.png', '..', 'con.png', 'foo.']) {
      const form = new FormData();
      form.append('file', new File(['png'], 'ok.png', { type: 'image/png' }));
      form.append('filename', name);
      const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: form });
      expect(res.status, name).toBe(400);
    }
  });

  it('同じ名前は 2 つ置けない', async () => {
    const post = await createPost();
    await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    const again = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect(again.status).toBe(409);
    expect((await json(again)).error).toBe('filename-taken');
  });

  it('消すと R2 からも消える', async () => {
    const post = await createPost();
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    const { media } = await json(res);

    expect((await apiJson('DELETE', `/api/media/${media.publicId}`)).status).toBe(200);
    expect(await env.MEDIA.get(`posts/${post.publicId}/sample.png`)).toBeNull();
    expect((await getRoot(media.url)).status).toBe(404);
  });
});

describe('再描画', () => {
  it('全記事の body_html を作り直す', async () => {
    const post = await createPost({ bodyMd: '## もとの見出し\n' });
    // renderer を更新した状況を作る: 保存済みの HTML を古い形に差し替える
    await db
      .prepare("UPDATE posts SET body_html = '<p>古い</p>', renderer_version = '0'")
      .run();

    const result = await apiJson('POST', '/api/rerender');
    expect(result.body.rendered).toBe(1);

    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>もとの見出し</h2>');
    expect(row?.renderer_version).not.toBe('0');
  });

  it('解決できない参照を記事ごとに返す', async () => {
    await createPost({ bodyMd: '![図](./missing.png)\n' });
    const result = await apiJson('POST', '/api/rerender');
    expect(result.body.warnings[0].unresolvedMedia).toEqual(['./missing.png']);
  });
});
