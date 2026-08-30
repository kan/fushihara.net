/**
 * このデプロイの素の値。**ここだけは何も import しない。**
 *
 * `config.ts` から分けてあるのは、E2E と `playwright.config.ts` が
 * mount を知る必要があるから。設定を読むだけで `createLily()` が走り、
 * テーマ経由で CSS まで引き込まれる (Node からは読めない)。
 *
 * 逆に言うと**ここに import を足すと E2E が起動しなくなる**。
 */

/**
 * マウント位置。**mount を変えるときに触るのはここ 1 行**（ユニットテストも E2E も
 * ここから引く）。`/blog-next` で並走していたときは、この 1 行の往復で済んでいた。
 */
export const MOUNT_PATH = '/blog';

const AUTHOR = 'KAN Fushihara (伏原 幹)';

export const SITE = {
  url: 'https://fushihara.net',
  // 読み手向けのサイト名。画面上のパンくず表示 (`fushihara.net / blog`) とは別物。
  name: 'ふしはらねっとのぶろぐ',
  description: `${AUTHOR} のブログ`,
  author: AUTHOR,
} as const;
