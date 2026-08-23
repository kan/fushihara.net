import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Worker のテストは実際の workerd 上で動かす。src/ のロジックも DOM に触れないので
// 同じプールで動く（board-data.ts / layout.ts は純粋なデータと計算のみ）。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
