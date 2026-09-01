/**
 * ルーティング定義。**予約パスも URL 生成もここを正にする。**
 *
 * 手で並べると route を足したときに更新を忘れる。ルータはこの定義から
 * マウントし、`core/paths.ts` はここからセグメント名を読んで URL を組み、
 * 記事のパス (canonical / alias) はここに載っているものを第 1 セグメントに
 * 使えない。3 者が同じ 1 箇所を見るので、片方だけ直して
 * 「URL は生成できるが予約されていない」が黙って成立することがない。
 *
 * mountPath が '/' でも '/blog' でも、判定は mount root 相対で同じ。
 */
export const ROUTE = {
  admin: 'admin',
  api: 'api',
  media: 'media',
  preview: 'preview',
  tags: 'tags',
  // 一覧の 2 ページ目以降 (`/page/2/`)。1 ページ目は付けない。
  page: 'page',
  styles: 'styles.css',
  rss: 'rss.xml',
  atom: 'atom.xml',
  sitemap: 'sitemap-index.xml',
  // 現行の URL をそのまま維持する。Astro の @astrojs/sitemap が index と
  // 中身を 2 ファイルに分けて出していたので、こちらも同じ 2 本を配る。
  sitemapUrls: 'sitemap-0.xml',
  postsJson: 'posts.json',
  notFound: '404',
} as const;

export const FIXED_ROUTES: readonly string[] = Object.values(ROUTE);

/**
 * OGP に出す絵。**Bluesky のリンクカードのサムネも同じものを使う。**
 *
 * 公式クライアントが URL から組むカードは OGP を読んで作られるので、API から
 * 投げるときも同じ絵にしないと、貼り方によって見え方が変わる。名前を 2 箇所に
 * 書かないよう、配信する側 (`routes/feeds.ts`) とサムネを読む側 (`api/`) が
 * これを見る。
 */
export const OGP_ASSET = 'ogp.png';

/**
 * mount root 直下に出す静的アセット (現行の出力を維持する)。
 *
 * **これだけはサイト側の都合が core に入っている。** lily として切り出すときは
 * config で渡す形にして site 層へ移す (`robots.txt` を配るサイトもあれば、
 * `ogp.png` を配らないサイトもある)。今そうしないのは、2 つ目のサイトが
 * 無いうちに設定の形を決めても当たらないため。
 */
export const STATIC_ASSETS = [
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  OGP_ASSET,
] as const;

export const RESERVED: ReadonlySet<string> = new Set<string>([...FIXED_ROUTES, ...STATIC_ASSETS]);

/**
 * 第 1 セグメントが予約されているか。
 *
 * `_` 始まりも予約する。将来 `_astro` のような内部用のプレフィックスを
 * 足したくなったときに、既存記事の URL と衝突しないようにするため。
 *
 * **判定は大小文字を無視する。** パスの一意性 (`post_paths_path_ci`) も解決
 * (`resolvePath` の `lower()`) も ci なので、ここだけ厳密にすると `Admin` が
 * 記事パスとして通ったうえで `/AdMiN` がその記事に解決されてしまう。
 */
export function isReservedSegment(segment: string): boolean {
  return segment.startsWith('_') || RESERVED.has(segment.toLowerCase());
}
