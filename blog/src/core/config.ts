/**
 * lily の設定。**サイト固有のものはここに集める。**
 *
 * `core/` はこの型しか知らない。サイト名・ドメイン・配色・パンくず・認証方式は
 * すべて呼び出し側 (`src/config.ts` と `src/site/`) が決める。
 */
import type { AuthAdapter } from './auth/index.ts';
import type { BlueskyCredentials } from './bluesky.ts';
import type { Theme } from './theme.ts';

export type SiteConfig = {
  /** 配信する origin。フィードと canonical の絶対 URL はここが起点。 */
  readonly url: string;
  /** 読み手向けのサイト名。`<title>` / OGP / フィードに出る。 */
  readonly name: string;
  readonly description: string;
  readonly author: string;
  /**
   * 配信する中身の言語（BCP 47）。`<html lang>` と Bluesky の告知に出る。
   *
   * **core に既定値を置かない。** `'ja'` を core が知っていると、別の言語の
   * deployment が黙って日本語として配られる（Bluesky の言語での絞り込みにも効く）。
   */
  readonly lang: string;
};

/**
 * ページを組むのに要る設定。公開側のルータ・フィード・添付はこれしか見ない
 * (認証を知らずに済むように分けてある)。
 */
export type PageConfig = {
  readonly site: SiteConfig;
  /** マウント位置。OSS の標準構成では `'/'`。 */
  readonly mountPath: string;
  readonly theme: Theme;
  readonly media?: MediaConfig;
};

export type MediaConfig = {
  /**
   * Cloudflare Images で配信時に変換するか。**無くても添付は R2 の原本で配れる。**
   * `IMAGES` バインディングが無いときは、true でも原本のまま。
   */
  readonly images?: boolean;
};

/**
 * `createLily()` に渡す設定。
 *
 * `auth` を**関数**にしているのは、チーム名や AUD のような deployment 固有の値を
 * リポジトリに焼き付けず、`env` から取れるようにするため (env はリクエストの
 * ときにしか無いので、モジュール読み込み時にアダプタを作れない)。
 */
export type LilyConfig<Bindings extends LilyBindings = LilyBindings> = PageConfig & {
  readonly auth: (env: Bindings) => AuthAdapter;
  /**
   * Bluesky の資格情報。**無ければ告知の口が「未設定」を返す**（機能ごと
   * 落ちるのではなく、押せないことが管理画面から分かる）。
   *
   * `auth` と同じく関数なのは、App Password が Worker の secret にしか無く、
   * env はリクエストのときにしか手に入らないため。
   */
  readonly bluesky?: (env: Bindings) => BlueskyCredentials | null;
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
  /** 画像の最適化。**無い前提を保つ**（Deploy to Cloudflare が用意しない）。 */
  readonly IMAGES?: ImagesBinding;
};
