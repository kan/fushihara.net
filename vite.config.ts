import { defineConfig, type Plugin } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { SOCIAL_LINKS } from './src/board-data';

/**
 * Social 付箋のアカウントを `<link rel="me">` として `<head>` に出す。
 *
 * 「このリンク先は自分だ」の宣言。Mastodon は相互リンクを見て検証に使う
 * （X と Bluesky は読まない。Bluesky はハンドルがドメインであること自体が
 * その証明になるので、meta で示すものが無い）。
 *
 * **ビルド時に焼く。** 出す値はリクエストに依らないので、Worker を通す理由が無い
 * （通すとトップページが毎回 Worker を経由し、ETag と 304 を自前で扱うことになる）。
 *
 * URL は `src/board-data.ts` の `SOCIAL_LINKS` が正。付箋と `<head>` に同じ一覧を
 * 手で書くと片方だけ古くなり、`rel="me"` は URL が 1 文字違うだけで効かなくなる。
 */
function relMe(): Plugin {
  return {
    name: 'rel-me',
    transformIndexHtml: {
      order: 'pre',
      handler: () =>
        SOCIAL_LINKS.map(({ url }) => ({
          tag: 'link',
          injectTo: 'head' as const,
          attrs: { rel: 'me', href: url },
        })),
    },
  };
}

export default defineConfig({
  // favicon 一式は本体とブログの両方が同じものを配る必要があるので shared/ に置き、
  // 双方の publicDir をそこへ向けている (ブログ側は blog/astro.config.mjs)。
  // 2 箇所にコピーを持つと必ず片方だけ古くなる。
  publicDir: 'shared/public',
  plugins: [cloudflare(), relMe()],
});
