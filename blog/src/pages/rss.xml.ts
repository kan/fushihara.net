import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedPosts } from '../lib/posts';
import { base, postHref } from '../lib/paths';
import { SITE_NAME, SITE_DESCRIPTION } from '../lib/site';

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

  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: blogRoot,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: postHref(post.id),
    })),
  });
}
