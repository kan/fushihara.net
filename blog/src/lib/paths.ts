/**
 * URL の起点。`site.ts` と分けてあるのは、こちらが `import.meta.env` に依存するため。
 * Vite の外 (Playwright の素の Node) からは読めないので、**両者を統合しないこと**。
 * E2E は `site.ts` の名前を import して突き合わせている (一度統合して壊した)。
 *
 * `import.meta.env.BASE_URL` の末尾スラッシュは astro.config の trailingSlash 設定に
 * 左右されるので、素で連結すると `/blog//x` と `/blogx` が混ざる。
 */
export const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** 記事の URL。CONTRACT.md で `/blog/<slug>/` に固定してある */
export function postHref(id: string): string {
  return `${base}${id}/`;
}
