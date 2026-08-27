import { env } from 'cloudflare:test';
import { createLily } from '../../src/core/app.ts';
import type { AuthAdapter, AuthUser } from '../../src/core/auth/index.ts';
import { createPost, publishPost, setRenderedHtml } from '../../src/core/db/posts.ts';
import { setPostTags } from '../../src/core/db/tags.ts';
import { RENDERER_VERSION, renderMarkdown } from '../../src/core/render/index.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { lily } from '../../src/config.ts';
import { theme } from '../../src/site/theme.ts';
import { db } from '../db/helpers.ts';

export const SITE = 'https://fushihara.net';
export const ROOT_SITE = 'https://blog.example.com';

/** `/blog` にマウントした本番同等のアプリ。 */
export async function get(path: string): Promise<Response> {
  return await lily.fetch(new Request(`${SITE}${path}`), env);
}

/**
 * 認証のスタブ。`stubUser` に値を入れると通り、null なら拒否する。
 *
 * 本番の設定 (`src/config.ts`) は Cloudflare Access で、テストでは
 * ACCESS_TEAM / ACCESS_AUD が空なので必ず拒否になる。通る側を見たいときは
 * こちらのアプリを使う。
 */
export let stubUser: AuthUser | null = null;

export function setStubUser(user: AuthUser | null): void {
  stubUser = user;
}

const stubAuth: AuthAdapter = {
  name: 'stub',
  authenticate: async () =>
    stubUser ? { ok: true, user: stubUser } : { ok: false, reason: 'スタブが拒否' },
};

/** root mount。core に `/blog` が焼き付いていないことを見るために使う。 */
const rootApp = createLily({
  site: {
    url: ROOT_SITE,
    name: 'ルート',
    description: 'root mount',
    author: 'someone',
  },
  mountPath: '/',
  theme,
  auth: () => stubAuth,
});

export async function getRoot(path: string): Promise<Response> {
  return await rootApp.fetch(new Request(`https://blog.example.com${path}`), env);
}

export async function getRootRequest(request: Request): Promise<Response> {
  return await rootApp.fetch(request, env);
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

/**
 * 管理 API を認証済みで叩く。root mount のアプリなので、パスは `/api/...`。
 *
 * 本番の設定 (`src/config.ts`) は Cloudflare Access で、テストでは
 * ACCESS_TEAM / ACCESS_AUD が空なので必ず拒否になる。通る側を見たいときは
 * こちらを使う。
 */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  setStubUser({ id: 'admin', email: 'kan@example.com' });
  const request = new Request(`https://blog.example.com${path}`, init);
  // ブラウザは同一オリジンでも非 GET には Origin を付ける。CSRF の防御が
  // それを見ているので、テストのリクエストも同じ形にする。
  if (!request.headers.has('Origin')) request.headers.set('Origin', ROOT_SITE);
  return await getRootRequest(request);
}

/** レスポンスの JSON。テストでは形を都度書かずに読む。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json(res: Response): Promise<any> {
  return await res.json();
}

/** JSON を送って JSON を受け取る。 */
export async function apiJson(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await api(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await json(res) };
}
