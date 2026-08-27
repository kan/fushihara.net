/**
 * 予約パスは routing 定義から導出する。
 *
 * 手で並べると route を足したときに更新を忘れる。ルータはこの定義から
 * マウントし、記事のパス (canonical / alias) はここに載っているものを
 * 第 1 セグメントに使えない。
 *
 * mountPath が '/' でも '/blog' でも、判定は mount root 相対で同じ。
 */
export const FIXED_ROUTES = [
  'admin',
  'api',
  'media',
  'preview',
  'tags',
  'rss.xml',
  'atom.xml',
  'sitemap-index.xml',
  'posts.json',
  '404',
] as const;

/** mount root 直下に出す静的アセット (現行の出力を維持する)。 */
export const STATIC_ASSETS = [
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'ogp.png',
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
