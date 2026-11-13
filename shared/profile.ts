/**
 * サイトの持ち主のプロフィール。**本体とブログの両方が読む。**
 *
 * - 本体: Social 付箋のアイコン、`<link rel="me">`、トップページの JSON-LD
 *   （`src/board-data.ts` の `SOCIAL_LINKS` と `vite.config.ts`）
 * - ブログ: lily に渡す `site.authorUrl` / `site.sameAs`（`blog/src/site/meta.ts`）。
 *   lily が記事と一覧の JSON-LD の著者に載せる
 *
 * **同じ人を 2 つのサイトで別々に書くと、片方だけ古くなる。** `rel="me"` も
 * `sameAs` も、URL が 1 文字違うだけで黙って効かなくなる。
 *
 * Node からも Workers からもブラウザからも読むので、何も import しない。
 */

/** 絶対 URL の起点。本体の `og:url` や Markdown のリンク、ブログの `SITE.url` */
export const SITE_ORIGIN = 'https://fushihara.net';

/** 本体サイト。ブログの JSON-LD では著者の `url` になる */
export const OWNER_URL = `${SITE_ORIGIN}/`;

/** JSON-LD の `Person` の `name`。本体の中央の付箋の見出しと同じ */
export const OWNER_NAME = 'KAN Fushihara';

/**
 * 自分のアカウント。**並び順はそのまま Social 付箋のアイコンの並びになる**
 * （`src/board-data.ts` がここに simple-icons のアイコンを当てる）。
 */
export const SOCIAL = {
  bluesky: 'https://bsky.app/profile/kan.fushihara.net',
  x: 'https://twitter.com/__kan',
  github: 'https://github.com/kan',
  facebook: 'https://www.facebook.com/kan.fushihara',
  instagram: 'https://www.instagram.com/kanf',
} as const;

/** `rel="me"` と JSON-LD の `sameAs` に出す URL の一覧 */
export const SOCIAL_URLS: readonly string[] = Object.values(SOCIAL);
