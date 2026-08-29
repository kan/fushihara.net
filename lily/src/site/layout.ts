/**
 * ページの外枠。fushihara.net のブログとしての見た目・文言・OGP はここに閉じる。
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { STATIC_ASSETS } from '../core/routes/fixed.ts';
import type { PageContext, Pagination } from '../core/theme.ts';
import { ADMIN_LINK, THEME_INIT, THEME_TOGGLE } from './client.ts';

/**
 * mount root 直下に出す静的アセット。実体は本体サイトと共有の `shared/public`。
 *
 * `satisfies` で `STATIC_ASSETS` に載っているものだけを参照していることを型で
 * 確かめる。core 側の予約と食い違うと、その名前の記事パスが作れてしまう。
 */
const ASSET = {
  favicon: 'favicon.ico',
  faviconSvg: 'favicon.svg',
  appleTouchIcon: 'apple-touch-icon.png',
  ogp: 'ogp.png',
} as const satisfies Record<string, (typeof STATIC_ASSETS)[number]>;

export type LayoutOptions = {
  /** ページ名。トップは省略してサイト名だけにする。 */
  readonly page?: string;
  readonly description?: string;
  readonly ogType?: 'website' | 'article';
  /**
   * パンくずを `h1` で出すか。一覧ではパンくずがそのままページの見出しになるが、
   * 記事ページでは `h1` は記事タイトルのものなので段落に落とす。
   */
  readonly brandIsHeading?: boolean;
  /** 一覧のページ送り。前後のページを `<link rel>` で示すのに使う。 */
  readonly pagination?: Pagination;
  /**
   * 管理画面のリンクの行き先。省略すると管理画面のトップに向く。
   * **リンク自体は常に出て、hidden 属性で隠してある。**
   */
  readonly adminUrl?: string;
};

/** トップはサイト名だけ、下層は「ページ名 | サイト名」。 */
export function pageTitle(siteName: string, page?: string): string {
  return page ? `${page} | ${siteName}` : siteName;
}

export async function layout(
  context: PageContext,
  options: LayoutOptions,
  body: HtmlEscapedString | Promise<HtmlEscapedString>,
): Promise<string> {
  const { site, urls, canonicalUrl } = context;
  const title = pageTitle(site.name, options.page);
  const description = options.description ?? site.description;
  const brand = options.brandIsHeading ? 'h1' : 'p';
  // 記事ページからは編集画面へ直行する (URL は core が組む)。
  const adminUrl = options.adminUrl ?? urls.admin();

  return String(await html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    ${canonicalUrl === null
      ? // 404 とプレビューに canonical / og:url を出さない。実在ページとして
        // クローラに拾わせないため。
        html`<meta name="robots" content="noindex" />`
      : html`<link rel="canonical" href="${canonicalUrl}" />`}

    <script>
      ${raw(THEME_INIT)}
    </script>

    <link rel="stylesheet" href="${urls.stylesheet()}" />

    <!-- .ico を先に書くのは、SVG に対応するブラウザがそちらを選ぶため
         (本体の index.html と同じ並び)。 -->
    <link rel="icon" href="${urls.asset(ASSET.favicon)}" sizes="32x32" />
    <link rel="icon" href="${urls.asset(ASSET.faviconSvg)}" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="${urls.asset(ASSET.appleTouchIcon)}" />

    <!-- 前後のページを示す。一覧が分かれていることをクローラに伝えるため。 -->
    ${options.pagination?.prevUrl
      ? html`<link rel="prev" href="${options.pagination.prevUrl}" />`
      : ''}
    ${options.pagination?.nextUrl
      ? html`<link rel="next" href="${options.pagination.nextUrl}" />`
      : ''}

    <link rel="alternate" type="application/rss+xml" title="${site.name}" href="${urls.feed('rss')}" />

    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="${options.ogType ?? 'website'}" />
    ${canonicalUrl === null ? '' : html`<meta property="og:url" content="${canonicalUrl}" />`}
    <!-- og:image は絶対 URL でないとクローラが解決できない。 -->
    <meta property="og:image" content="${urls.asset(ASSET.ogp, { absolute: true })}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    ${site.twitter ? html`<meta name="twitter:site" content="${site.twitter}" />` : ''}

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+JP:wght@400;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div class="wrap">
      <header class="site-header">
        <!-- パンくず。「どこの」「何か」を 1 行で示し、リンク先も 2 つに分かれる。
             これがあるので nav に Portfolio へのリンクは要らない。 -->
        <${brand} class="brand">
          <a href="/">fushihara.net</a>
          <span class="sep" aria-hidden="true">/</span>
          <a href="${urls.index()}">blog</a>
        </${brand}>
        <nav>
          <a href="${urls.feed('rss')}">RSS</a>
          <!-- 管理画面へのリンク。**全員に同じ HTML を配り**、管理画面を開いた
               ことがある端末でだけ client.ts が hidden 属性を外す。訪問者ごとに
               HTML を変えると、共有キャッシュに載ったそれが読者に配られる。 -->
          <a class="admin-link" href="${adminUrl}" rel="nofollow" hidden
            >${options.adminUrl ? 'この記事を編集' : '管理'}</a
          >
          <!-- ここに書けるのは中立な文言まで。サーバー側では訪問者のテーマが
               分からないため。読み込み後に client.ts が方向つきラベルへ差し替える
               (JS が動かない環境ではこのまま)。 -->
          <button class="theme-toggle" type="button" aria-label="テーマを切り替える">
            ${raw(MOON_ICON)}${raw(SUN_ICON)}
          </button>
        </nav>
      </header>

      <main>${body}</main>

      <footer class="site-footer">
        <p>&copy; ${site.author}</p>
      </footer>
    </div>

    <script>
      ${raw(THEME_TOGGLE)}
      ${raw(ADMIN_LINK)}
    </script>
  </body>
</html>
`);
}


// アイコンは両方置いて CSS で出し分ける。サーバー側では訪問者のテーマが
// 分からないので、JS で差し込むと一瞬まちがった方が見える。
const MOON_ICON = `<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const SUN_ICON = `<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
