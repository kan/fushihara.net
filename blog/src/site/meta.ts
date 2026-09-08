/**
 * このデプロイの素の値。**Node から素で読めるものしか import しない。**
 *
 * `config.ts` から分けてあるのは、E2E と `playwright.config.ts` が
 * mount を知る必要があるから。設定を読むだけで `createLily()` が走り、
 * テーマ経由で CSS まで引き込まれる (Node からは読めない)。
 *
 * 逆に言うと**テーマや CSS に繋がる import を足すと E2E が起動しなくなる**。
 *
 * **lily はバレル (`@kanf/lily`) ではなくサブパスから読む。** バレルは core 一式を
 * 引き込むので、workerd のランタイム型が要る。E2E のプロジェクトは DOM lib で
 * 動くので、それを入れると `Request` / `Response` の宣言が二重になる。
 * `@kanf/lily/paths` は Workers の型を 1 つも使わない。
 */
import { createPaths } from '@kanf/lily/paths';

/**
 * マウント位置。**mount を変えるときに触るのはここ 1 行**（ユニットテストも E2E も
 * ここから引く）。`/blog-next` で並走していたときは、この 1 行の往復で済んでいた。
 */
export const MOUNT_PATH = '/blog';

const AUTHOR = 'KAN Fushihara (伏原 幹)';

/**
 * mount root 直下に配る静的アセット。**実体は `dist/` の直下**で、favicon 3 点は
 * 本体サイトと共有の `shared/public`、`ogp.png` は `blog/public` (ブログ専用の絵)。
 * どちらも `scripts/build.mjs` が集めてくる。
 *
 * ここに挙げた名前は `createLily()` に渡り、**配信と記事パスの予約の両方**になる。
 * 名前を 2 箇所に書かないよう、テーマ (`site/layout.ts`) もここから引く。
 */
export const ASSET = {
  favicon: 'favicon.ico',
  faviconSvg: 'favicon.svg',
  appleTouchIcon: 'apple-touch-icon.png',
  ogp: 'ogp.png',
} as const;

export const ASSETS: readonly string[] = Object.values(ASSET);

const ORIGIN = 'https://fushihara.net';

/**
 * 静的アセットの URL を組む口。**配信側と同じ `createPaths()` を通す。**
 *
 * 素で連結すると root mount (`MOUNT_PATH = '/'`) で `//ogp.png` になるし、
 * `urls.asset()` が encode やキャッシュバスターを足した日にここだけ取り残される。
 * mount は 1 行で動かせることになっているので、別実装を 2 本目に持たない。
 * 予約語は要らない（URL を組むだけ）ので `assets` は渡していない。
 */
const { urls } = createPaths({ site: { url: ORIGIN }, mountPath: MOUNT_PATH });

export const SITE = {
  url: ORIGIN,
  // 読み手向けのサイト名。画面上のパンくず表示 (`fushihara.net / blog`) とは別物。
  name: 'ふしはらねっとのぶろぐ',
  description: `${AUTHOR} のブログ`,
  author: AUTHOR,
  // `<html lang>` と Bluesky の告知に出る。**言語を書く場所はここだけ。**
  lang: 'ja',
  /**
   * 日付を切り出すタイムゾーン。**管理画面の編集欄と一覧がこれで組む。**
   *
   * **`shared/date.ts` の JST 固定と同じ値であること。** 公開ページの日付は
   * あちら（本体サイトと共有なので設定を読めない）が組むので、ずれると
   * 編集画面で入れた日時と `/blog/` に出る日付が食い違う。コメントで揃える
   * のではなく、`test/date.test.ts` が両者の出力を突き合わせている。
   */
  timeZone: 'Asia/Tokyo',
  /**
   * 記事が自分の絵を選んでいないときに出る 1 枚。**寸法は絵と一緒に直すこと。**
   *
   * `<mount>/ogp.png` として配っている実体を指す（`ASSET.ogp`）。core は絵の
   * 配信に関与しないので、URL はここで組んで渡す。
   */
  ogImage: { url: urls.asset(ASSET.ogp, { absolute: true }), width: 1200, height: 630 },
} as const;
