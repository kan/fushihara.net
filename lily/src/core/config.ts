/**
 * lily の設定。**サイト固有のものはここに集める。**
 *
 * `core/` はこの型しか知らない。サイト名・ドメイン・配色・パンくず・認証方式は
 * すべて呼び出し側 (`src/config.ts` と `src/site/`) が決める。
 */
import type { Theme } from './theme.ts';

export type SiteConfig = {
  /** 配信する origin。フィードと canonical の絶対 URL はここが起点。 */
  readonly url: string;
  /** 読み手向けのサイト名。`<title>` / OGP / フィードに出る。 */
  readonly name: string;
  readonly description: string;
  readonly author: string;
  /** OGP の `twitter:site`。無ければ出さない。 */
  readonly twitter?: string;
};

export type LilyConfig = {
  readonly site: SiteConfig;
  /** マウント位置。OSS の標準構成では `'/'`。 */
  readonly mountPath: string;
  readonly theme: Theme;
};

/**
 * core が要求するバインディング。
 *
 * `Env`（`wrangler types` の生成物）ではなくこの構造で受けるのは、core が
 * サイト側の設定ファイルを知らずに済むようにするため。
 */
export type LilyBindings = {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  /** mount root 直下に出す静的アセット (favicon 3 点と ogp.png)。 */
  readonly ASSETS: Fetcher;
};
