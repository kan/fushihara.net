import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
// experimental_ の名前どおり Astro の実験的 API。package.json の astro は
// キャレット指定なので、マイナー更新でこれが消えるとビルドごと落ちる (CI の build で
// 止まるのでデプロイはされない)。代わりに Markdown を markdown-it 等で変換し直す
// 手もあるが、画像パイプラインの出力とコードハイライトがページと食い違う。
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import { publishedPosts } from '../lib/posts';
import { base, postHref } from '../lib/paths';
import { SITE_NAME, SITE_DESCRIPTION } from '../lib/site';
import { toFeedHtml } from '../lib/feed-html';

// 購読者のリーダーに残り続ける URL なので /blog/rss.xml から動かさない。
export async function GET(context: APIContext) {
  // draft の扱いは publishedPosts() に一本化してある。ここで二重に落とすと、
  // 本番では到達しない (既に落ちている) ぶんテストが書けないコードになるうえ、
  // dev だけ一覧に出て RSS に出ない、という食い違いも生む。
  const posts = await publishedPosts();

  // チャンネルの link と各記事の link は、どちらもブログのルートを起点にする。
  // context.site をそのまま渡すとリーダーの「サイトを開く」がポートフォリオ側に
  // 飛んでしまう。記事の link を相対にしてあるのは、この起点に対して解決させるため。
  const blogRoot = new URL(base, context.site);

  // 本文は記事ページと同じ <Content /> を文字列にして載せる。Markdown を別の
  // パーサで変換し直すと、画像パイプラインの出力もコードハイライトもページと
  // 食い違う。description は今までどおり要約のまま (CONTRACT.md の「出力」節)。
  const container = await AstroContainer.create();
  const items = await Promise.all(
    posts.map(async (post) => {
      const href = postHref(post.id);
      const { Content } = await render(post);
      const html = await container.renderToString(Content);
      return {
        title: post.data.title,
        pubDate: post.data.date,
        description: post.data.description,
        link: href,
        content: toFeedHtml(html, new URL(href, blogRoot)),
      };
    }),
  );

  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: blogRoot,
    items,
  });
}
