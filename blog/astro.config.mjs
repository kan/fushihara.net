// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/lib/site';

// fushihara.net/blog* は Cloudflare の route でこの Worker に届く
// (route は Custom Domain より優先される)。Astro 側も base を合わせる。
export default defineConfig({
  site: SITE_URL,
  base: '/blog',
  // URL は /blog/<slug>/ で固定する。公開後は変えられないので trailingSlash も固定。
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Astro は base を出力パスに含めない (リンクだけ /blog/… になる)。
  // Worker には dist/ 全体をそのまま配らせたいので、出力側を base に合わせる。
  // ここを変えたら wrangler.jsonc の assets.directory も一緒に見直すこと。
  outDir: './dist/blog',
  // favicon 一式はリポジトリ直下の shared/public に置いて本体と共有する
  // (本体側は vite.config.ts の publicDir)。出力は outDir 直下、つまり
  // dist/blog/ に入るので、ブログからは base 付きの /blog/favicon.svg で参照する。
  publicDir: '../shared/public',
  // content layer のストアはこの下に置かれる。E2E のビルドと通常のビルド / dev
  // サーバーで場所を分けないと、同じファイルを奪い合って互いの記事を拾う
  // (実測: dev を実記事で起動したまま E2E を回すと、dev 側に fixture が出る)。
  cacheDir: process.env.BLOG_CONTENT_DIR ? './node_modules/.astro-e2e' : './node_modules/.astro',
  integrations: [sitemap()],
  markdown: {
    // defaultColor: false にすると、Shiki は色を直接書かず --shiki-light / --shiki-dark
    // だけを出す。styles/blog.css がそれを light-dark() に渡して 1 行で切り替える
    // (どちらを使うかは shared/tokens.css の color-scheme が決める)。
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      wrap: true,
    },
  },
  vite: {
    // shared/ はプロジェクト外 (リポジトリ直下) にあるので dev サーバに読ませる
    server: { fs: { allow: ['..'] } },
  },
});
