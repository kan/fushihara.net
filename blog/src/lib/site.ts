/**
 * サイトの名前。HTML の <title>・OGP・RSS に出る「読み手向けの名前」で、
 * 画面上のパンくず表示 (`fushihara.net / blog`) とは別物。
 * 5 箇所に散らすと必ずずれるのでここだけに置く。
 *
 * **このファイルはどのランタイムからでも読めるように保つこと。** E2E が import して
 * 名前の一致を検査している。URL 側 (`paths.ts`) は `import.meta.env` に依存するので
 * 統合してはいけない (一度やって壊した)。
 */
export const SITE_NAME = 'ふしはらねっとのぶろぐ';

/**
 * 配信するサイトの origin。`astro.config.mjs` の `site` と E2E がここを読む。
 * RSS の絶対 URL も canonical もこれを起点にするので、散らすと必ずずれる。
 */
export const SITE_URL = 'https://fushihara.net';

export const AUTHOR = 'Kan Fushihara (伏原 幹)';

export const SITE_DESCRIPTION = `${AUTHOR} のブログ`;

/** トップはサイト名だけ、下層は「ページ名 | サイト名」 */
export function pageTitle(page?: string): string {
  return page ? `${page} | ${SITE_NAME}` : SITE_NAME;
}
