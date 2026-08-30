/**
 * identity と時刻。テストから差し替えたくなったらここだけ見ればよいようにまとめる。
 */

/** 記事と media の不変の identity。既定の URL でもある。 */
export function newPublicId(): string {
  return crypto.randomUUID();
}

/** UTC ISO8601 (末尾 Z・ミリ秒あり)。文字列比較でそのまま並べられる。 */
export function nowIso(): string {
  return new Date().toISOString();
}
