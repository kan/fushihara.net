/**
 * 添付として受け付ける形式。**この表が唯一の正。**
 *
 * 受け口が 2 つあり、判断の材料が違う:
 *
 * - 管理画面からのアップロードは、ブラウザが付けた `Content-Type` を見る
 * - portable import は書庫を読むので Content-Type が無く、拡張子で決める
 *
 * 形式の一覧を両方に持つと、片方だけ増やした日に「管理画面からは上げられるのに
 * 取り込み直せない添付」が黙って生まれる。だから拡張子 → MIME の対応を 1 本だけ
 * 持ち、受け付ける MIME はそこから導く。
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

/** アップロードで受け付ける `Content-Type`。**任意の形式を配らせない。** */
export const ALLOWED_MIME: ReadonlySet<string> = new Set(Object.values(MIME_BY_EXTENSION));

/** 拡張子から MIME を引く。知らない拡張子なら `undefined`。 */
export function mimeForFilename(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return undefined;
  return MIME_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()];
}
