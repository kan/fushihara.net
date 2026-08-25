// ブラウザから外部 API を直接叩かず、ここを経由させている。
// GitHub はレートリミット、ブログの RSS は XML を毎回ブラウザで解析させない
// (全文入りなので重い) のが理由。

const USER_AGENT = 'fushihara-net-portfolio';

// このプロキシはこのポートフォリオ専用。任意の username を通すと第三者が
// GitHub の公開プロキシとして使えてしまい、Worker のリクエスト枠と
// Cloudflare 出口 IP の未認証レートリミットを消費されて、本サイト自身の
// カードが落ちる。フロントは常にこの 1 人しか要求しないので固定する。
const ALLOWED_USERS = new Set(['kan']);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

// 上流のエラーを 1 時間ブラウザに持たれると、上流が復旧してもカードが
// 壊れたままになる。エラーは各レイヤでキャッシュさせない。
const ERROR_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/** 上流の失敗を表す JSON。キャッシュさせないヘッダはここに集約する */
export function jsonError(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: ERROR_HEADERS });
}

const GITHUB_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/vnd.github.v3+json',
};

/** 正の整数クエリを読む。未指定・不正値・範囲外は既定値と上限に寄せる */
function positiveInt(url: URL, key: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * username の検証を 1 箇所に集約する。ハンドラは検証済みの user だけを受け取るので、
 * 新しいエンドポイントを足したときにチェックを書き忘れようがない。
 */
function forAllowedUser(
  handler: (url: URL, user: string) => Promise<Response>,
): (url: URL, env: Env) => Promise<Response> {
  return async (url) => {
    const name = url.searchParams.get('username') ?? '';
    if (!ALLOWED_USERS.has(name)) {
      return jsonError(400, { error: 'unsupported username' });
    }
    return handler(url, name);
  };
}

/** 上流のレスポンスをそのまま転送する */
async function proxy(upstream: string, headers: HeadersInit): Promise<Response> {
  const res = await fetch(upstream, { headers });
  return new Response(res.body, {
    status: res.status,
    headers: res.ok ? JSON_HEADERS : ERROR_HEADERS,
  });
}

const repoListUrl = (username: string, perPage: number) =>
  `https://api.github.com/users/${encodeURIComponent(username)}/repos` +
  `?sort=pushed&per_page=${perPage}`;

export const githubRepos = forAllowedUser(async (url, user) => {
  const count = positiveInt(url, 'count', 10, 100);

  return proxy(repoListUrl(user, count), GITHUB_HEADERS);
});

/** 非 fork リポジトリの language を集計し、頻度順に上位 N 件を返す */
export const githubLanguages = forAllowedUser(async (url, user) => {
  const limit = positiveInt(url, 'limit', 5, 50);

  // 言語の傾向を掴むため最大 100 件のリポジトリを見る
  const res = await fetch(repoListUrl(user, 100), { headers: GITHUB_HEADERS });
  if (!res.ok) return jsonError(res.status, { languages: [] });

  const repos = (await res.json()) as { language: string | null; fork: boolean }[];

  const counts = new Map<string, number>();
  for (const r of repos) {
    if (!r.fork && r.language) {
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
  }

  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));

  return new Response(JSON.stringify({ languages }), { headers: JSON_HEADERS });
});

// --- ブログ (/blog) の記事一覧 ---

// ブログは別 Worker (fushihara-net-blog) が fushihara.net/blog* で配っている。
//
// **素の fetch で叩いてはいけない。** 同一ゾーンの URL へのサブリクエストは Worker
// ルートを再実行せず origin へ向かうので、origin を持たないこのゾーンでは 522 に
// なる (本番で踏んだ)。wrangler.jsonc の service binding 経由で直接呼ぶ。
// URL はホスト名を見られないが、ブログ Worker のパス解決に /blog/rss.xml が要る。
const BLOG_RSS_URL = 'https://fushihara.net/blog/rss.xml';

const XML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/** XML のテキストノードに現れる実体参照を戻す */
function decodeXml(text: string): string {
  return text.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] !== '#') return XML_ENTITIES[ref.toLowerCase()] ?? whole;
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole;
  });
}

// item ごとに RegExp を組み直さないよう、使うぶんだけ定数で持つ
const TAG_RE = {
  title: /<title>([\s\S]*?)<\/title>/,
  link: /<link>([\s\S]*?)<\/link>/,
  pubDate: /<pubDate>([\s\S]*?)<\/pubDate>/,
};

/** item 内の最初の <name>…</name> をテキストとして取り出す */
function tagText(item: string, name: keyof typeof TAG_RE): string {
  const found = TAG_RE[name].exec(item);
  return found ? decodeXml(found[1]).trim() : '';
}

/**
 * RSS 2.0 から記事の見出しだけを抜く。
 *
 * 正規表現で足りるのは、生成側 (@astrojs/rss → fast-xml-parser) が本文を CDATA では
 * なく実体参照で書くため。つまり XML 中に生の `<` はタグしか現れず、全文入りの
 * `<content:encoded>` の中身が item の切れ目を偽装することがない。
 * CDATA を吐く生成器に替えたらこの前提は崩れる (`blog/CONTRACT.md` は RSS の
 * 出力を約束しているが、書き方までは縛っていない)。
 */
function parseRssItems(xml: string, limit: number): { title: string; link: string; date: string }[] {
  const posts: { title: string; link: string; date: string }[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    // RSS は新しい順なので、必要な件数を取れたら残りの全文は読まない
    if (posts.length === limit) break;
    const title = tagText(item, 'title');
    const link = tagText(item, 'link');
    if (!title || !link) continue;

    // pubDate は RFC 822。表示形式はフロントに任せるので ISO に寄せておく
    const at = new Date(tagText(item, 'pubDate'));
    posts.push({ title, link, date: Number.isNaN(at.getTime()) ? '' : at.toISOString() });
  }
  return posts;
}

/** dev / preview には別 Worker のセッションが無く、binding は 503 を返すだけになる */
const isLocal = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

export const blog = async (url: URL, env: Env): Promise<Response> => {
  const count = positiveInt(url, 'count', 5, 20);

  // ローカルでは公開 URL をそのまま読む。同一ゾーンで Worker ルートが再実行されない
  // のは本番 (Cloudflare のエッジ) の話なので、素の fetch で本番の RSS が読める。
  const res = isLocal(url)
    ? await fetch(BLOG_RSS_URL, { headers: { 'User-Agent': USER_AGENT } })
    : await env.BLOG.fetch(BLOG_RSS_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return jsonError(res.status, { posts: [] });

  const posts = parseRssItems(await res.text(), count);
  if (posts.length === 0) {
    // 200 でも中身を取り出せないなら上流の異常とみなす。ここで 200 を返すと
    // worker/index.ts が空の控えを 30 日書いてしまい、付箋が「Loading...」で
    // 固定される。RSS の書き方が変わったとき (CDATA を吐く生成器に替えた等) に
    // 起きるのは、上流が落ちたときと同じ「前回の控えで凌ぐ」場面。
    return jsonError(502, { posts: [] });
  }

  return new Response(JSON.stringify({ posts }), { headers: JSON_HEADERS });
};
