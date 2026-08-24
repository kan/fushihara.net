import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  // favicon 一式は本体とブログの両方が同じものを配る必要があるので shared/ に置き、
  // 双方の publicDir をそこへ向けている (ブログ側は blog/astro.config.mjs)。
  // 2 箇所にコピーを持つと必ず片方だけ古くなる。
  publicDir: 'shared/public',
  plugins: [cloudflare()],
});
