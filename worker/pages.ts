/**
 * `/api/*` 以外で Worker が受けるもの: トップページ、robots.txt、sitemap.xml、404。
 * 中身は `src/agent.ts` が組む（ここはヘッダーと出し分けだけ）。経緯は issue #58。
 *
 * **トップページの HTML は `env.ASSETS.fetch(request)` にそのまま渡す。** 条件付き
 * リクエスト（`If-None-Match`）もアセット側が見て 304 を返すので、ETag を自前で
 * 扱わない。こちらが足すのは `Vary` と `Link` だけ。
 */
import {
  BLOG_PATHS,
  homeMarkdown,
  notFoundMarkdown,
  robotsTxt,
  SITEMAP_PATH,
  sitemapXml,
} from '../src/agent';

/**
 * Markdown を返すか。**`text/markdown` が `text/html` より上に来るときだけ。**
 *
 * それぞれの q は、一致する範囲のうち一番具体的なもの（`text/markdown` >
 * `text/*` > `*\/*`）から取る（RFC 9110 12.5.1）。同点なら HTML。ブラウザは
 * `text/html,…,*\/*;q=0.8` を送るので HTML になる。`Accept` が無い `curl` も HTML。
 *
 * ブログ（lily）と同じ規則。`/` と `/blog/` で出し分けの条件がずれないように。
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const ranges = accept.split(',').flatMap((part) => {
    const [range = '', ...params] = part.split(';');
    const type = range.trim().toLowerCase();
    // `type/subtype` として読めない範囲は捨てる
    if (!/^[^/\s]+\/[^/\s]+$/.test(type)) return [];
    const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    // 読めない q は 0 とみなす（壊れた値で重さを上げない）。範囲は 0〜1 に丸める
    return [{ type, q: Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0 }];
  });
  const quality = (type: string) => {
    const [major] = type.split('/');
    const match =
      ranges.find((r) => r.type === type) ??
      ranges.find((r) => r.type === `${major}/*`) ??
      ranges.find((r) => r.type === '*/*');
    return match?.q ?? 0;
  };
  const markdown = quality('text/markdown');
  return markdown > 0 && markdown > quality('text/html');
}

/** root の API Catalog（RFC 9727）。中身はブログ（lily）のもので、下の転送で届ける */
export const API_CATALOG_PATH = '/.well-known/api-catalog';

/**
 * root の `/.well-known/` から、ブログ（lily）の文書への転送。issue #59。
 *
 * **lily は mount（`/blog`）の外を配らない**ので、root の well-known は本体が受ける。
 * 中身を写さずに転送するのは、RFC 9727 が同じ文書を複数の場所に置くときは転送を
 * 勧めているため（中身の正はブログの 1 つだけになる）。
 *
 * - `/.well-known/mcp/server-card.json` は lily の置き場（`/blog/mcp/server-card`）と
 *   名前が違う。isitagentready はこの名前（SEP-1649 の場所）しか見ない
 * - **307 にする。** 308 / 301 はブラウザが恒久的に覚えるので、行き先を変えた日に戻せない
 */
export const WELL_KNOWN_REDIRECTS: Readonly<Record<string, string>> = {
  [API_CATALOG_PATH]: '/blog/.well-known/api-catalog',
  '/.well-known/ai-catalog.json': '/blog/.well-known/ai-catalog.json',
  '/.well-known/mcp/server-card.json': '/blog/mcp/server-card',
};

/** `Link` の共通部分。サイトマップ、ブログのフィード、API Catalog */
const DISCOVERY = [
  `<${SITEMAP_PATH}>; rel="sitemap"; type="application/xml"`,
  `<${BLOG_PATHS.feed}>; rel="alternate"; type="application/rss+xml"`,
  `<${API_CATALOG_PATH}>; rel="api-catalog"`,
];

/** トップページの `Link`。**同じ URL のもう片方の形**を `alternate` で指す */
function homeLink(served: 'html' | 'markdown'): string {
  const other = served === 'html' ? 'text/markdown' : 'text/html';
  return [`</>; rel="alternate"; type="${other}"`, ...DISCOVERY].join(', ');
}

/** 既存の `Vary` に `Accept` を足す（上書きすると `Accept-Encoding` などが消える） */
function addVary(headers: Headers): void {
  const current = headers.get('Vary');
  const names = current ? current.split(',').map((s) => s.trim()) : [];
  if (!names.some((n) => n.toLowerCase() === 'accept')) names.push('Accept');
  headers.set('Vary', names.join(', '));
}

/**
 * Markdown のレスポンス。
 *
 * **共有キャッシュに載せない（`private`）。** Cloudflare のエッジは
 * `Accept-Encoding` 以外の `Vary` を見ないので、載せると次にブラウザで開いた人に
 * Markdown が返る。今は Worker が先に動くのでエッジのキャッシュを通らないが、
 * Cache Rules を足した日に備える（lily と同じ扱い）。
 */
function markdown(request: Request, status: number, body: string, link: string): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      Vary: 'Accept',
      Link: link,
    },
  });
}

function text(request: Request, body: string, contentType: string): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
  });
}

/**
 * 静的アセットのレスポンスに `Vary: Accept`（と、あれば `Link`）を足して返す。
 * 条件付きリクエストもアセット側が見るので、304 もそのまま通る。
 */
async function fromAssets(request: Request, env: Env, link?: string): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  addVary(headers);
  if (link) headers.set('Link', link);
  return new Response(res.body, { status: res.status, headers });
}

export async function home(request: Request, env: Env): Promise<Response> {
  if (prefersMarkdown(request.headers.get('Accept'))) {
    return markdown(request, 200, homeMarkdown(), homeLink('markdown'));
  }
  return fromAssets(request, env, homeLink('html'));
}

export function robots(request: Request): Response {
  return text(request, robotsTxt(), 'text/plain; charset=utf-8');
}

export function sitemap(request: Request): Response {
  return text(request, sitemapXml(), 'application/xml; charset=utf-8');
}

/**
 * 転送 1 本分。**メソッドの扱いもここで持つ**（`PAGES` は GET / HEAD しか通さないため、
 * `worker/index.ts` はこちらを先に引く）。
 *
 * - **`Access-Control-Allow-Origin: *` を付ける。** 転送先（lily）は 3 文書とも `*` で
 *   配るが、別のオリジンのブラウザは 307 の時点で CORS の検査に落ちて先へ進めない。
 *   OPTIONS（`If-None-Match` などで飛ぶ preflight）には 204 を返す
 * - **API Catalog は 307 にも `Link: rel="api-catalog"` を付ける**（RFC 9727 の 2 節の
 *   SHALL）。転送を追わずに HEAD の応答だけを見るクライアントにも見えるように
 * - GET / HEAD / OPTIONS 以外は 405。クエリは転送先へそのまま渡す
 */
function redirectTo(target: string, link: string | null) {
  return (request: Request): Response => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const headers: Record<string, string> = {
      ...cors,
      Location: `${target}${new URL(request.url).search}`,
      'Cache-Control': 'public, max-age=3600',
    };
    if (link !== null) headers.Link = link;
    return new Response(null, { status: 307, headers });
  };
}

/** `WELL_KNOWN_REDIRECTS` の各パスのハンドラ。`worker/index.ts` が `PAGES` より先に引く */
export const WELL_KNOWN: Readonly<Record<string, (request: Request) => Response>> =
  Object.fromEntries(
    Object.entries(WELL_KNOWN_REDIRECTS).map(([path, target]) => [
      path,
      redirectTo(target, path === API_CATALOG_PATH ? `<${API_CATALOG_PATH}>; rel="api-catalog"` : null),
    ]),
  );

/**
 * どの静的アセットにも一致しなかったリクエスト。
 *
 * **HTML のほうは今までどおりアセット側の 404 を返す**（本文の無い 404）。
 * Markdown を求められたときだけ、トップとサイトマップへのリンクを返す。
 * ステータスは 404 のまま。
 */
export async function notFound(request: Request, env: Env): Promise<Response> {
  if (prefersMarkdown(request.headers.get('Accept'))) {
    return markdown(request, 404, notFoundMarkdown(), DISCOVERY.join(', '));
  }
  return fromAssets(request, env);
}
