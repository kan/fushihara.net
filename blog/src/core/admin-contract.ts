/**
 * 管理画面と、それを配る側の**契約**。
 *
 * `core/routes/admin.ts`（差し込む側）・`src/site/client.ts`（公開ページで読む側）・
 * `src/admin/`（管理画面）が同じ値を見る必要があるものだけを置く。
 *
 * **ここは何も import しない**（型を除く）。管理画面は vite で別にバンドルされるので、
 * route のモジュールから値を import すると hono ごとブラウザ側へ運ぶことになる。
 * URL の組み立ては `core/paths.ts` の持ち物で、ここには置かない。
 */
import type { SiteConfig } from './config.ts';

/**
 * 入口 HTML に差し込む `<meta>` の名前。受け皿は `src/admin/index.html` にある
 * （HTML だけは import できないので、そこだけ 3 箇所目のリテラルになる）。
 */
export const SITE_META = 'lily:site';

/**
 * meta に載せる中身。**サイト設定そのもの。**
 *
 * 別の型として写さないのは、`SiteConfig` に項目を足したときに設定画面へ勝手に
 * 届くようにするため（写すと、足し忘れても型が通って「設定画面にだけ出ない」で終わる）。
 */
export type AdminSiteMeta = SiteConfig;

/**
 * 「この端末では管理画面を開いたことがある」という目印。**権限は何も持たない。**
 *
 * 公開ページに管理画面へのリンクを出すためだけのもので、リンク先は認証が守っている
 * （偽造しても、出るのはログイン画面へ行くリンクだけ）。
 *
 * **公開ページの HTML を訪問者ごとに変えないため**にこの形にしてある。公開ページは
 * `s-maxage` で共有キャッシュに載るので、ログイン中だけ HTML を変えると、その HTML が
 * 匿名の読者にも配られる（逆に匿名版が載っていると管理者にリンクが出ない）。判定を
 * ブラウザ側でやれば、配る HTML は全員同じままにできる。
 *
 * Cloudflare Access の `CF_Authorization` を直接見られないのは、あれが HttpOnly で
 * JS から読めないため。
 *
 * **名前と値を 1 つの単位で持つ。** 読む側は cookie の 1 項目とこれを丸ごと比べるので、
 * 名前だけを共有すると、値を変えた日に比較が黙って false になる。
 */
export const ADMIN_HINT = 'lily_admin=1';

/** 目印の寿命（秒）。切れても管理画面を開き直せば付き直る。 */
export const ADMIN_HINT_MAX_AGE = 60 * 60 * 24 * 30;
