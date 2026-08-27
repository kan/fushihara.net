/**
 * fushihara.net の設定。**`core/` はここを知らない。**
 */
import { createLily } from './core/app.ts';
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
});
