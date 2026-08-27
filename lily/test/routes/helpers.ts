import { env } from 'cloudflare:test';
import { createLily } from '../../src/core/app.ts';
import { createPost, publishPost, setRenderedHtml } from '../../src/core/db/posts.ts';
import { setPostTags } from '../../src/core/db/tags.ts';
import { RENDERER_VERSION, renderMarkdown } from '../../src/core/render/index.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { lily } from '../../src/config.ts';
import { theme } from '../../src/site/theme.ts';
import { db } from '../db/helpers.ts';

export const SITE = 'https://fushihara.net';

/** `/blog` にマウントした本番同等のアプリ。 */
export async function get(path: string): Promise<Response> {
  return await lily.fetch(new Request(`${SITE}${path}`), env);
}

/** root mount。core に `/blog` が焼き付いていないことを見るために使う。 */
const rootApp = createLily({
  site: {
    url: 'https://blog.example.com',
    name: 'ルート',
    description: 'root mount',
    author: 'someone',
  },
  mountPath: '/',
  theme,
});

export async function getRoot(path: string): Promise<Response> {
  return await rootApp.fetch(new Request(`https://blog.example.com${path}`), env);
}

export type SeedOptions = {
  title?: string;
  bodyMd?: string;
  description?: string;
  path?: string;
  publishedAt?: string;
  tags?: string[];
  /** 下書きのまま置く。 */
  draft?: boolean;
  /** body_html を作らない (配信時に body_md から描画する経路を見る)。 */
  skipRender?: boolean;
};

export async function seedPost(options: SeedOptions = {}): Promise<PostRow> {
  const created = await createPost(db, {
    title: options.title ?? 'はじめての記事',
    bodyMd: options.bodyMd ?? '## 見出し\n\n本文。\n',
    description: options.description ?? 'ためしに書いた',
    path: options.path ?? 'start-blog',
  });
  if (!created.ok) throw new Error(`seedPost に失敗した: ${created.error.code}`);
  const post = created.value;

  if (options.tags) await setPostTags(db, post.id, options.tags);
  if (!options.skipRender) {
    const { html } = await renderMarkdown(post.body_md);
    await setRenderedHtml(db, post.id, html, RENDERER_VERSION);
  }
  if (!options.draft) {
    return (await publishPost(db, post.id, options.publishedAt ?? '2026-08-01T00:00:00.000Z'))!;
  }
  return post;
}
