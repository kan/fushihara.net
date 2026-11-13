import { defineConfig, type Plugin } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
// 拡張子を付けて読む。Vite の `configLoader: 'native'`（次のメジャーで既定になる）は
// 拡張子の無い import を解決しないので、ここから読むファイルの import も同じ
import { homeJsonLd, scriptJson, SITE_DESCRIPTION, SITE_TITLE } from './src/agent.ts';
import { escapeHtml } from './src/note-html.ts';
import { SITE_ORIGIN, SOCIAL_URLS } from './shared/profile.ts';

/**
 * Social 付箋のアカウントを `<link rel="me">` として `<head>` に出す。
 *
 * 「このリンク先は自分だ」の宣言。Mastodon は相互リンクを見て検証に使う
 * （X と Bluesky は読まない。Bluesky はハンドルがドメインであること自体が
 * その証明になるので、meta で示すものが無い）。
 *
 * **ビルド時に焼く。** 出す値はリクエストに依らないので、Worker で組まない。
 * トップページは `Accept` の出し分けのために Worker を通るが、HTML はビルドした
 * `index.html` をそのまま返す（`worker/pages.ts`）。
 *
 * URL は `shared/profile.ts` の `SOCIAL_URLS` が正（Social 付箋と JSON-LD の
 * `sameAs` も同じもの）。付箋と `<head>` に同じ一覧を手で書くと片方だけ古くなり、
 * `rel="me"` は URL が 1 文字違うだけで効かなくなる。
 */
function relMe(): Plugin {
  return {
    name: 'rel-me',
    transformIndexHtml: {
      order: 'pre',
      handler: () =>
        SOCIAL_URLS.map((url) => ({
          tag: 'link',
          injectTo: 'head' as const,
          attrs: { rel: 'me', href: url },
        })),
    },
  };
}

/**
 * トップページの JSON-LD（`WebSite` と `Person`）を `<head>` に焼く。
 *
 * `rel="me"` と同じくリクエストに依らないので、ビルド時に出す。中身と、
 * `sameAs` を `rel="me"` と同じ一覧から出す理由は `src/agent.ts` の `homeJsonLd()`。
 */
function jsonLd(): Plugin {
  return {
    name: 'json-ld',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'script',
          injectTo: 'head' as const,
          attrs: { type: 'application/ld+json' },
          children: scriptJson(homeJsonLd()),
        },
      ],
    },
  };
}

/**
 * `index.html` の `{{SITE_TITLE}}` / `{{SITE_DESCRIPTION}}` / `{{SITE_ORIGIN}}` を
 * 置き換える。
 *
 * **正は `src/agent.ts` と `shared/profile.ts`。** Markdown 版の frontmatter と
 * JSON-LD も同じ値を使うので、HTML の `<title>` や `og:*` と食い違わない。
 *
 * **`%SITE_TITLE%` の形にしないこと。** Vite 自身が `%名前%` を環境変数で置き換え、
 * それがこのプラグインより先に動く（同じ名前の環境変数があると、こちらの値が
 * 黙って負ける）。
 *
 * 知らない名前は置き換えずに例外にする。綴りを間違えたまま配られないように。
 */
function siteMeta(): Plugin {
  const values: Record<string, string> = { SITE_TITLE, SITE_DESCRIPTION, SITE_ORIGIN };
  return {
    name: 'site-meta',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
          const value = values[key];
          if (value === undefined) throw new Error(`index.html: {{${key}}} の値が無い`);
          return escapeHtml(value);
        }),
    },
  };
}

export default defineConfig({
  // favicon 一式は本体とブログの両方が同じものを配る必要があるので shared/ に置き、
  // 本体はここを向け、ブログは blog/scripts/build.mjs が dist/ へコピーする。
  // 2 箇所にコピーを持つと必ず片方だけ古くなる。
  publicDir: 'shared/public',
  plugins: [cloudflare(), siteMeta(), relMe(), jsonLd()],
});
