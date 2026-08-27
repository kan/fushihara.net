/**
 * fushihara.net の設定。**`core/` はここを知らない。**
 */
import { createLily } from './core/app.ts';
import { cloudflareAccess } from './core/auth/access.ts';
import { theme } from './site/theme.ts';

const AUTHOR = 'KAN Fushihara (伏原 幹)';

export const lily = createLily({
  site: {
    url: 'https://fushihara.net',
    // 読み手向けのサイト名。画面上のパンくず表示 (`fushihara.net / blog`) とは別物。
    name: 'ふしはらねっとのぶろぐ',
    description: `${AUTHOR} のブログ`,
    author: AUTHOR,
    twitter: '@__kan',
  },
  // **切り替えのときにここを触る。** 並走中は '/blog-next'、差し替え後は '/blog'。
  // route (wrangler.jsonc) と必ずセットで見ること。
  mountPath: '/blog',
  theme,
  // 管理画面と管理 API は Cloudflare Access の手前で止まる。ここでの検証は
  // 二重の守りで、Access を経由しない経路で開かないようにするためのもの。
  // チーム名と AUD は wrangler.jsonc の vars（deployment 固有の値）。
  auth: (env: Env) => cloudflareAccess({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD }),
});
