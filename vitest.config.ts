import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Worker のテストは実際の workerd 上で動かす。src/ のロジックも DOM に触れないので
// 同じプールで動く（board-data.ts / layout.ts は純粋なデータと計算のみ）。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // wrangler.jsonc の service binding (BLOG → fushihara-net-blog) は、この
      // プールには存在しないので置き換える。無いままだと workerd が起動時に
      // 「no such service is defined」で落ちてテストが 1 つも動かない。
      //
      // テスト側は worker.fetch(request, env, ctx) に自前の env を渡すので、
      // ここのスタブが実際に呼ばれることはない。起動を通すためだけのもの。
      miniflare: {
        serviceBindings: { BLOG: () => new Response('unused', { status: 501 }) },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
