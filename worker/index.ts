import { blog, githubLanguages, githubRepos, jsonError } from './api';

interface Route {
  handler: (url: URL) => Promise<Response>;
  /** そのエンドポイントが解釈するクエリ。控えのキーはこれだけで組む */
  keyParams: string[];
}

const ROUTES: Record<string, Route> = {
  '/api/blog': { handler: blog, keyParams: ['count'] },
  '/api/github': { handler: githubRepos, keyParams: ['username', 'count'] },
  '/api/github-languages': { handler: githubLanguages, keyParams: ['username', 'limit'] },
};

// 上流が落ちている間もカードを出せるように、成功したレスポンスの控えを別キーで
// 長期保存しておく。GitHub の未認証レートリミットは Cloudflare の出口 IP 共有で
// 割と簡単に枯れるので、そのたびに「Loading...」に戻るのを避けたい。
const BACKUP_MAX_AGE = 60 * 60 * 24 * 30; // 30 日
// 控えを返すときは短めにする。1 時間ブラウザに持たれると、上流が復旧しても
// 古いカードが残り続ける。
const BACKUP_SERVE_MAX_AGE = 300;

/**
 * リクエストからキャッシュのキーを 2 本作る。どちらも **そのエンドポイントが解釈する
 * クエリだけ**で組む。`?utm_source=…` のような未知のクエリでキーが分裂すると、
 * 中身が同じでも毎回上流を叩くことになり、控えで守りたかったレートリミットを
 * そこで消費してしまう。
 *
 * `keyParams` はハンドラが読むクエリ（`forAllowedUser` の `username`、`positiveInt` の
 * `count` / `limit`）と対応している。**ハンドラが読むクエリを増やしたらここも足すこと。**
 * 漏れると、別々のリクエストが 1 つのキャッシュを共有する。
 *
 * テストからも同じ導出を使いたいので export している (`test/worker.test.ts`)。
 */
export function cacheKeys(url: URL): { primary: Request; backup: Request } {
  const canonical = new URL(`${url.origin}${url.pathname}`);
  for (const name of ROUTES[url.pathname]?.keyParams ?? []) {
    const value = url.searchParams.get(name);
    if (value !== null) canonical.searchParams.set(name, value);
  }

  const backup = new URL(canonical);
  backup.pathname = `/__backup${url.pathname}`;
  return { primary: new Request(canonical.toString()), backup: new Request(backup.toString()) };
}

/** ヘッダだけ差し替えたコピーを作る */
function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(res.body, { status: res.status, headers });
}

/**
 * ハンドラの例外を非 ok のレスポンスに均す。fetch は DNS / TLS の失敗やサブリクエストの
 * 上限で reject するので、包まないと控えを引く前に Worker ごと落ちる (1101)。
 */
async function runHandler(handler: Route['handler'], url: URL): Promise<Response> {
  try {
    return await handler(url);
  } catch (err) {
    console.error(`${url.pathname} の取得に失敗`, err);
    return jsonError(502, { error: 'upstream unavailable' });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];

    // wrangler.jsonc の run_worker_first により通常は /api/* しか届かないが、
    // 未定義の /api/xxx はここから静的アセット側にフォールバックして 404 になる。
    if (!route) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const { primary, backup } = cacheKeys(url);

    const cache = caches.default;
    const cached = await cache.match(primary);
    if (cached) return cached;

    const response = await runHandler(route.handler, url);

    if (response.ok) {
      // キャッシュ書き込みでレスポンスを待たせない
      ctx.waitUntil(cache.put(primary, response.clone()));
      ctx.waitUntil(
        cache.put(backup, withHeaders(response.clone(), {
          'Cache-Control': `public, max-age=${BACKUP_MAX_AGE}`,
        })),
      );
      return response;
    }

    // 上流が落ちているときは最後に成功したものを出す。無ければエラーをそのまま返す
    // (ハンドラが空の一覧を返すので、ボードは board-data.ts の静的テキストで残る)。
    const stale = await cache.match(backup);
    if (!stale) return response;

    return withHeaders(stale, {
      'Cache-Control': `public, max-age=${BACKUP_SERVE_MAX_AGE}`,
      'X-Backup': 'hit',
    });
  },
} satisfies ExportedHandler<Env>;
