/**
 * このデプロイの素の値。**ここだけは何も import しない。**
 *
 * `config.ts` から分けてあるのは、E2E と `playwright.config.ts` が
 * mount を知る必要があるから。設定を読むだけで `createLily()` が走り、
 * テーマ経由で CSS まで引き込まれる (Node からは読めない)。
 *
 * 逆に言うと**ここに import を足すと E2E が起動しなくなる**。
 */

/** マウント位置。**切り替えのときにここを触る** (`/blog-next` → `/blog`)。 */
export const MOUNT_PATH = '/blog-next';

const AUTHOR = 'KAN Fushihara (伏原 幹)';

export const SITE = {
  url: 'https://fushihara.net',
  // 読み手向けのサイト名。画面上のパンくず表示 (`fushihara.net / blog`) とは別物。
  name: 'ふしはらねっとのぶろぐ',
  description: `${AUTHOR} のブログ`,
  author: AUTHOR,
  twitter: '@__kan',
} as const;
