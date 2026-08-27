/**
 * テーマが実装する型。**core は HTML を 1 バイトも持たない。**
 *
 * レイアウト・CSS・文言・パンくず・OGP はすべてテーマ側の持ち物で、core が
 * 渡すのはページに出すデータだけ。lily を切り出したときに、このインターフェース
 * だけを満たせば別の見た目に差し替えられる。
 */
import type { SiteConfig } from './config.ts';
import type { Urls } from './paths.ts';

export type TagView = {
  readonly name: string;
  readonly slug: string;
  readonly url: string;
};

export type PostSummaryView = {
  readonly title: string;
  readonly description: string | null;
  /** 公開日。下書きは null。 */
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  /** canonical path から組んだ URL。 */
  readonly url: string;
  readonly tags: readonly TagView[];
  readonly isDraft: boolean;
};

/** 記事ページ。`html` は placeholder を解決済みの、そのまま出せる HTML。 */
export type PostView = PostSummaryView & { readonly html: string };

export type PageContext = {
  readonly site: SiteConfig;
  readonly urls: Urls;
  /**
   * このページの正規 URL (絶対)。**404 とプレビューのように、それ自身の URL を
   * 持たない / 持たせたくないページは null。** テーマはそのとき canonical と
   * `og:url` を出さず、`noindex` を出す。
   */
  readonly canonicalUrl: string | null;
};

/**
 * ページを組むのは非同期でよい。テンプレートエンジンによっては (hono/html も)
 * 値に Promise が混ざると Promise を返すので、同期に固定すると呼び出し側で
 * 静かに `[object Promise]` を出す事故が起きうる。
 */
export interface Theme {
  /** 配信する 1 本のスタイルシート。 */
  readonly stylesheet: string;
  index(context: PageContext, posts: readonly PostSummaryView[]): Promise<string>;
  post(context: PageContext, post: PostView): Promise<string>;
  tag(context: PageContext, tag: TagView, posts: readonly PostSummaryView[]): Promise<string>;
  notFound(context: PageContext): Promise<string>;
}
