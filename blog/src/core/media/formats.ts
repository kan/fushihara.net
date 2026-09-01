/**
 * 添付として受け付ける形式。**この表が唯一の正。**
 *
 * **どちらの受け口も拡張子で決める。**
 *
 * portable import は書庫を読むので Content-Type が無く、拡張子しか手がかりが無い。
 * だからアップロード側も拡張子に揃える。ブラウザの `Content-Type` だけで通すと、
 * `photo.jfif` (Windows の Chrome が付ける JPEG の名前) のように**上げられるのに
 * 取り込み直せない添付**が生まれ、export → import で画像だけが黙って消える。
 *
 * 表を 1 本にするだけでは足りない。**判断の材料まで揃えないと往復が壊れる。**
 */

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** 拡張子から MIME を引く。知らない拡張子なら `undefined`。 */
export function mimeForFilename(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return undefined;
  return MIME_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()];
}

/**
 * OGP（と Bluesky のリンクカード）に出せる形式。**受け付ける形式より狭い。**
 *
 * - SVG は多くのクローラが OGP の画像として読まない（読めても寸法が定まらない）
 * - GIF は動かないまま 1 コマ目で止まって出るので、絵として選ぶ意味が薄い
 * - AVIF は読まないクローラがまだあるうえ、`media/dimensions.ts` が寸法を
 *   読めないので `og:image:width` / `height` も出せない
 */
const OGP_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function canBeOgp(mime: string): boolean {
  return OGP_MIMES.has(mime);
}
