import { githubLanguages, githubRepos, zenn } from './api';

const ROUTES: Record<string, (url: URL) => Promise<Response>> = {
  '/api/zenn': zenn,
  '/api/github': githubRepos,
  '/api/github-languages': githubLanguages,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];

    // wrangler.jsonc の run_worker_first により通常は /api/* しか届かないが、
    // 未定義の /api/xxx はここから静的アセット側にフォールバックして 404 になる。
    if (!handler) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await handler(url);
    // キャッシュ書き込みでレスポンスを待たせない
    if (response.ok) ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
