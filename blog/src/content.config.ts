import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * YAML では `description:` のように値を書かないと null になり、キーごと省略した場合
 * (undefined) とは別物になる。テンプレートを埋めながら書けば必ず起きるので、
 * 「空欄 = 省略」として揃える。
 */
function blankAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === null || v === '' ? undefined : v), schema);
}

/**
 * 記事の唯一の入力は blog/content/posts/<slug>/index.md。
 * このスキーマは Astro のためだけのものではなく、将来ここを自作 OSS に
 * 置き換えるときの契約そのもの (CONTRACT.md 参照)。
 * フレームワーク固有のキーをここに足さないこと。
 */
const posts = defineCollection({
  loader: glob({
    // src/ の外に置いてあるのは「記事はコードではなく資産」を構成で示すため。
    //
    // BLOG_CONTENT_DIR は E2E 専用の逃げ道。playwright.config.ts が
    // ./test-content/posts を指してビルドすることで、テストのフィクスチャが公開
    // 記事に混ざらないようにしている。素の `npm run build` は必ず ./content/posts。
    base: process.env.BLOG_CONTENT_DIR ?? './content/posts',
    pattern: '**/index.md',
    // 既定の id は "<slug>/index" になってしまうので、URL に出る形に揃える。
    generateId: ({ entry }) => entry.replace(/\/index\.md$/, ''),
  }),
  schema: z.object({
    // title と date は必須なので、空欄はエラーのままでよい (書き忘れを教えたい)
    title: z.string(),
    date: z.date(),
    updated: blankAsUnset(z.date().optional()),
    tags: blankAsUnset(z.array(z.string()).default([])),
    description: blankAsUnset(z.string().optional()),
    draft: blankAsUnset(z.boolean().default(false)),
  }),
});

export const collections = { posts };
