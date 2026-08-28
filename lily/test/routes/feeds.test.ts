import { beforeEach, describe, expect, it } from 'vitest';
import { changeCanonicalPath } from '../../src/core/db/post-paths.ts';
import { createMedia } from '../../src/core/db/media.ts';
import { db, resetDb } from '../db/helpers.ts';
import { get, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

/**
 * `content:encoded` / `<content>` の中身を XML のエスケープから戻して返す。
 *
 * **戻るのは HTML まで。** 本文に書いた `<` は HTML シリアライザが数値実体で
 * 書いているので、そちらは `decodeHtml` で別に戻す (エスケープが 2 層あり、
 * 一度に戻すと本文とタグの区別が付かなくなる)。
 *
 * 見つからなければ落とす。生成器を変えて形が変わったときに、**黙って通る側へ
 * 倒れない**ようにするため (ブラウザのある E2E では DOMParser で見る)。
 */
function bodyOf(xml: string, tag: 'content:encoded' | 'content'): string {
  const matched = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!matched?.[1]) throw new Error(`${tag} が見つからない`);
  return matched[1]
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    // `&amp;` は最後。先に戻すと二重にデコードしてしまう。
    .replaceAll('&amp;', '&');
}

/** HTML の実体参照を戻す (本文に書いた HTML を読むときだけ使う)。 */
function decodeHtml(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

const RICH_BODY = [
  '## 見出し',
  '',
  '[記事内リンク](../other/)と画像。',
  '',
  '![図](./sample.png)',
  '',
  '```ts',
  'export const a = 1;',
  '```',
  '',
  '```',
  '<img src="./cat.png">',
  '```',
].join('\n');

async function seedRichPost() {
  const post = await seedPost({ path: 'start-blog', bodyMd: RICH_BODY, skipRender: true });
  await createMedia(db, {
    postId: post.id,
    filename: 'sample.png',
    r2Key: 'posts/start-blog/sample.png',
    mime: 'image/png',
    bytes: 1,
  });
  return post;
}

describe('RSS', () => {
  it('チャンネルはサイト名とブログのルートを指す', async () => {
    const res = await get('/blog/rss.xml');
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('<title>ふしはらねっとのぶろぐ</title>');
    // ポートフォリオ側ではなくブログのルート。リーダーの「サイトを開く」がここへ飛ぶ。
    expect(xml).toContain(`<link>${SITE}/blog/</link>`);
  });

  it('記事の link と guid が canonical の絶対 URL', async () => {
    await seedPost({ path: 'start-blog', title: 'はじめての記事' });
    const xml = await (await get('/blog/rss.xml')).text();
    expect(xml).toContain(`<link>${SITE}/blog/start-blog/</link>`);
    expect(xml).toContain(`<guid isPermaLink="true">${SITE}/blog/start-blog/</guid>`);
    expect(xml).toContain('<pubDate>Sat, 01 Aug 2026 00:00:00 GMT</pubDate>');
  });

  it('description は要約のまま、本文は全文を content:encoded に入れる', async () => {
    await seedRichPost();
    const xml = await (await get('/blog/rss.xml')).text();
    expect(xml).toContain('<description>ためしに書いた</description>');
    expect(bodyOf(xml, 'content:encoded')).toContain('<h2>見出し</h2>');
  });

  it('CDATA ではなく実体参照で書く', async () => {
    // 本体サイトの /api/blog が正規表現で RSS を読んでいて、CDATA を吐いた瞬間に
    // 壊れる (XML 中に生の `<` がタグしか現れない、という前提で item を切っている)。
    await seedRichPost();
    const xml = await (await get('/blog/rss.xml')).text();
    expect(xml).not.toContain('<![CDATA[');
    expect(xml).toContain('&lt;h2&gt;');
  });

  it('本文に相対 URL が残らない', async () => {
    // リーダーは記事の URL を起点に解決してくれないので、画像も記事内リンクも壊れる。
    await seedRichPost();
    const body = bodyOf(await (await get('/blog/rss.xml')).text(), 'content:encoded');

    expect(body).toContain(`href="${SITE}/blog/other/"`);
    expect(body).toMatch(new RegExp(`src="${SITE}/blog/media/[^"]+/sample\\.png"`));
    expect(body).not.toContain('lily-media://');
  });

  it('生 HTML で書いた相対 URL も絶対化する', async () => {
    // 属性の見方が狭いと、ページでは解決されるのにフィードでは相対のまま残る。
    await seedPost({
      path: 'start-blog',
      bodyMd: `<a href='../other/'>一重引用符</a>\n\n<a HREF="../upper/">大文字</a>\n`,
      skipRender: true,
    });
    const body = bodyOf(await (await get('/blog/rss.xml')).text(), 'content:encoded');

    expect(body).toContain(`href="${SITE}/blog/other/"`);
    // 属性名の大小はそのまま残す (書き換えるのは値だけ)
    expect(body).toMatch(new RegExp(`href="${SITE}/blog/upper/"`, 'i'));
    expect(body).not.toContain('../');
  });

  it('本文が CSS 変数に頼らない', async () => {
    // リーダーはこのブログのスタイルシートを読まないので、変数に入れた色は解決されない。
    await seedRichPost();
    const body = bodyOf(await (await get('/blog/rss.xml')).text(), 'content:encoded');

    expect(body).not.toContain('--shiki-');
    expect(body).not.toContain('var(');
    expect(body, 'コードに色が付く').toMatch(/style="[^"]*color:#/);
  });

  it('本文に書いた HTML は書き換えない', async () => {
    // 書き換えてよいのはタグの中の属性だけ。コードブロックの中身は本文。
    await seedRichPost();
    const body = bodyOf(await (await get('/blog/rss.xml')).text(), 'content:encoded');
    expect(decodeHtml(body)).toContain('<img src="./cat.png">');
  });

  it('下書きは載らない', async () => {
    await seedPost({ path: 'shown', title: '公開した記事' });
    await seedPost({ path: 'hidden', title: '下書きの記事', draft: true });
    const xml = await (await get('/blog/rss.xml')).text();
    expect(xml).toContain('公開した記事');
    expect(xml).not.toContain('下書きの記事');
  });

  it('新しい順に並ぶ', async () => {
    await seedPost({ path: 'old', title: '古い', publishedAt: '2026-01-01T00:00:00.000Z' });
    await seedPost({ path: 'new', title: '新しい', publishedAt: '2026-08-01T00:00:00.000Z' });
    const xml = await (await get('/blog/rss.xml')).text();
    expect(xml.indexOf('新しい')).toBeLessThan(xml.indexOf('古い'));
  });

  it('直近 50 件までにする', async () => {
    // 全文を配るので、全件だと際限なく重くなる。
    for (let i = 0; i < 55; i++) {
      await seedPost({
        path: `p${i}`,
        title: `記事 ${i}`,
        publishedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
    const xml = await (await get('/blog/rss.xml')).text();
    expect((xml.match(/<item>/g) ?? []).length).toBe(50);
    // 新しい方から 50 件。いちばん古い記事は落ちる
    expect(xml).toContain('記事 54');
    expect(xml).not.toContain('<title>記事 0</title>');

    const atom = await (await get('/blog/atom.xml')).text();
    expect((atom.match(/<entry>/g) ?? []).length).toBe(50);
  });

  it('一覧が autodiscovery で指す', async () => {
    const html = await (await get('/blog/')).text();
    expect(html).toContain('<link rel="alternate" type="application/rss+xml"');
    expect(html).toContain('href="/blog/rss.xml"');
  });
});

describe('Atom', () => {
  it('全文を配り、self と alternate を持つ', async () => {
    await seedRichPost();
    const res = await get('/blog/atom.xml');
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain(`<link rel="self" type="application/atom+xml" href="${SITE}/blog/atom.xml"/>`);
    expect(xml).toContain(`<link rel="alternate" type="text/html" href="${SITE}/blog/"/>`);
    expect(bodyOf(xml, 'content')).toContain('<h2>見出し</h2>');
  });

  it('id は URL ではなく public_id なので、パスを変えても変わらない', async () => {
    const post = await seedPost({ path: 'old-path' });
    const before = await (await get('/blog/atom.xml')).text();
    expect(before).toContain(`<id>urn:uuid:${post.public_id}</id>`);

    await changeCanonicalPath(db, post.id, 'new-path');
    const after = await (await get('/blog/atom.xml')).text();
    expect(after).toContain(`<id>urn:uuid:${post.public_id}</id>`);
    expect(after).toContain(`href="${SITE}/blog/new-path/"`);
  });

  it('記事が無くても updated を持つ (Atom の必須要素)', async () => {
    const xml = await (await get('/blog/atom.xml')).text();
    expect(xml).toMatch(/<updated>\d{4}-\d{2}-\d{2}T/);
  });

  it('下書きは載らない', async () => {
    await seedPost({ path: 'hidden', title: '下書きの記事', draft: true });
    expect(await (await get('/blog/atom.xml')).text()).not.toContain('下書きの記事');
  });
});

describe('サイトマップ', () => {
  it('index が現行どおり sitemap-0.xml を指す', async () => {
    const xml = await (await get('/blog/sitemap-index.xml')).text();
    expect(xml).toContain(`<loc>${SITE}/blog/sitemap-0.xml</loc>`);
  });

  it('一覧・公開記事・記事のあるタグが載る', async () => {
    await seedPost({ path: 'shown', tags: ['dev'] });
    await seedPost({ path: 'hidden', draft: true, tags: ['secret'] });

    const xml = await (await get('/blog/sitemap-0.xml')).text();
    expect(xml).toContain(`<loc>${SITE}/blog/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/blog/shown/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/blog/tags/dev/</loc>`);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);

    expect(xml).not.toContain('/blog/hidden/');
    // 公開記事が 0 件のタグページを索引に出しても意味がない
    expect(xml).not.toContain('/blog/tags/secret/');
  });
});

describe('posts.json', () => {
  // 本体サイトの Blog 付箋が読む口。RSS を正規表現で解析するのをやめるための出力。
  it('公開記事だけを新しい順に、canonical の絶対 URL で返す', async () => {
    await seedPost({ path: 'new', title: '新しい', publishedAt: '2026-08-02T00:00:00.000Z' });
    await seedPost({ path: 'old', title: '古い', publishedAt: '2026-08-01T00:00:00.000Z' });
    await seedPost({ path: 'draft', title: '下書き', draft: true });

    const res = await get('/blog/posts.json');
    expect(res.status).toBe(200);
    const { posts } = (await res.json()) as {
      posts: { id: string; title: string; url: string; published_at: string; tags: string[] }[];
    };

    expect(posts.map((p) => p.title)).toEqual(['新しい', '古い']);
    expect(posts[0]?.url).toBe('https://fushihara.net/blog/new/');
    expect(posts[0]?.published_at).toBe('2026-08-02T00:00:00.000Z');
  });

  it('limit は既定 5・上限 20 で、読めない値は既定に落とす', async () => {
    // 上限を超える要求で全件返すと、増えたぶんだけ本体サイトが重くなる。
    for (let i = 0; i < 25; i++) {
      await seedPost({
        path: `p${i}`,
        title: `記事 ${i}`,
        publishedAt: `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
    const count = async (query: string) =>
      ((await (await get(`/blog/posts.json${query}`)).json()) as { posts: unknown[] }).posts.length;

    expect(await count('')).toBe(5);
    expect(await count('?limit=3')).toBe(3);
    expect(await count('?limit=999')).toBe(20);
    expect(await count('?limit=0')).toBe(5);
    expect(await count('?limit=abc')).toBe(5);
  });

  it('タグと説明も載せる', async () => {
    await seedPost({ path: 'p', description: 'ようやく', tags: ['dev', '日記'] });
    const { posts } = (await (await get('/blog/posts.json')).json()) as {
      posts: { description: string | null; tags: string[] }[];
    };
    expect(posts[0]?.description).toBe('ようやく');
    expect(posts[0]?.tags.sort()).toEqual(['dev', '日記']);
  });
});

describe('静的アセット', () => {
  const ICONS = [
    '/blog/favicon.ico',
    '/blog/favicon.svg',
    '/blog/apple-touch-icon.png',
    '/blog/ogp.png',
  ];

  it('mount root 直下に実体が出る', async () => {
    for (const path of ICONS) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect((await res.arrayBuffer()).byteLength, path).toBeGreaterThan(0);
    }
  });

  it('レイアウトの link と og:image が実体を指す', async () => {
    const html = await (await get('/blog/')).text();
    expect(html).toContain('href="/blog/favicon.ico" sizes="32x32"');
    expect(html).toContain('href="/blog/favicon.svg" type="image/svg+xml"');
    expect(html).toContain('rel="apple-touch-icon" href="/blog/apple-touch-icon.png"');
    expect(html).toContain(`content="${SITE}/blog/ogp.png"`);
  });

  it('favicon.svg がパースできる XML である', async () => {
    // SVG は XML なので、コメントにハイフン 2 個を書くだけで壊れる (実際に踏んだ)。
    // 壊れたファイルも 200 で配信されるので、中身まで見る。
    const svg = await (await get('/blog/favicon.svg')).text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // `<!-- ... -- ... -->` は XML として不正
    expect(svg.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('<!--');
  });
});
