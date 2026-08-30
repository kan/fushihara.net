// ブラウザから外部 API を直接叩かず、ここを経由させている。
// GitHub はレートリミットの回避、ブログは**同一ゾーンの制限**が理由。
// (ブラウザからは /blog/posts.json を直に読めるが、Worker からは service binding を
//  通さないと届かない。下の「取りに行き方」を参照。) どちらもエッジキャッシュと、
// 上流が落ちた日の控えを 1 箇所で持てるのが利点。

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

// GitHub が language として返すが、スキルとして並べても意味の無いもの。
// 「Dockerfile が書けます」は読み手に何も伝えない。
const NON_LANGUAGES = new Set([
  'Dockerfile', 'Shell', 'Makefile', 'HTML', 'CSS', 'Batchfile',
  'Vim Script', 'Emacs Lisp', 'Roff', 'TeX',
  // PowerShell は言語ではあるが、スキルとして並べたいものではない（本人の判断）
  'PowerShell',
]);

// この年数より古いものは数えない。リポジトリ数の累積は「昔たくさん書いた言語」に
// 引っ張られるので、直近だけを見て「今書いている言語」に寄せる。
const SKILL_WINDOW_YEARS = 3;

interface RepoLanguage {
  language: string | null;
  fork: boolean;
  pushed_at: string;
}

/** 非 fork リポジトリの language を頻度順に数える */
function countLanguages(repos: RepoLanguage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (r.fork || !r.language || NON_LANGUAGES.has(r.language)) continue;
    counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  return counts;
}

/** 直近に触った非 fork リポジトリの language を集計し、頻度順に上位 N 件を返す */
export const githubLanguages = forAllowedUser(async (url, user) => {
  const limit = positiveInt(url, 'limit', 5, 50);

  // 言語の傾向を掴むため最大 100 件のリポジトリを見る
  const res = await fetch(repoListUrl(user, 100), { headers: GITHUB_HEADERS });
  if (!res.ok) return jsonError(res.status, { languages: [] });

  const repos = (await res.json()) as RepoLanguage[];

  const since = new Date();
  since.setFullYear(since.getFullYear() - SKILL_WINDOW_YEARS);
  const recent = repos.filter((r) => new Date(r.pushed_at) >= since);

  // 直近に何も触っていなければ全期間で数える。空のカードを出すよりはましで、
  // 上流は成功しているので「控え」の出番でもない。
  const counts = countLanguages(recent.length > 0 ? recent : repos);

  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));

  return new Response(JSON.stringify({ languages }), { headers: JSON_HEADERS });
});

// --- ブログ (/blog) の記事一覧 ---

// ブログは別 Worker (fushihara-blog) が fushihara.net/blog* で配っている。
//
// **素の fetch で叩いてはいけない。** 同一ゾーンの URL へのサブリクエストは Worker
// ルートを再実行せず origin へ向かうので、origin を持たないこのゾーンでは 522 に
// なる (本番で踏んだ)。wrangler.jsonc の service binding 経由で直接呼ぶ。
// URL はホスト名を見られないが、ブログ Worker のパス解決に /blog/ が要る。
//
// **読むのは posts.json で、RSS ではない。** lily が本体サイトのために生やしている
// 口なので、全文入りの XML を正規表現で読む必要がもう無い (Astro 版はそうしていた)。
const BLOG_POSTS_URL = 'https://fushihara.net/blog/posts.json';

type BlogPost = { title: string; link: string; date: string };

/**
 * posts.json を付箋が読む形に均す。
 *
 * **知らないキーは見ない。** lily 側が列を増やしても本体は壊れないし、
 * `/api/blog` の外向きの形 (`{title, link, date}`) も変わらない。
 */
function toPosts(body: unknown, limit: number): BlogPost[] {
  const source = (body as { posts?: unknown })?.posts;
  if (!Array.isArray(source)) return [];

  const posts: BlogPost[] = [];
  for (const item of source) {
    if (posts.length === limit) break;
    const { title, url, published_at } = (item ?? {}) as Record<string, unknown>;
    if (typeof title !== 'string' || title === '') continue;
    if (typeof url !== 'string' || url === '') continue;

    // published_at は UTC の ISO8601。表示形式はフロントに任せるので形だけ揃える。
    const at = new Date(typeof published_at === 'string' ? published_at : '');
    posts.push({ title, link: url, date: Number.isNaN(at.getTime()) ? '' : at.toISOString() });
  }
  return posts;
}

/** dev / preview には別 Worker のセッションが無く、binding は 503 を返すだけになる */
const isLocal = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

export const blog = async (url: URL, env: Env): Promise<Response> => {
  const count = positiveInt(url, 'count', 5, 20);
  // 上流にも件数を伝える。posts.json の limit は既定 5・上限 20 で count と同じ形。
  const upstream = `${BLOG_POSTS_URL}?limit=${count}`;

  // ローカルでは公開 URL をそのまま読む。同一ゾーンで Worker ルートが再実行されない
  // のは本番 (Cloudflare のエッジ) の話なので、素の fetch で本番の口が読める。
  const res = isLocal(url)
    ? await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } })
    : await env.BLOG.fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return jsonError(res.status, { posts: [] });

  // 上流が limit を無視しても付箋がはみ出さないよう、こちらでも絞る。
  const posts = toPosts(await res.json().catch(() => null), count);
  if (posts.length === 0) {
    // 200 でも中身を取り出せないなら上流の異常とみなす。ここで 200 を返すと
    // worker/index.ts が空の控えを 30 日書いてしまい、付箋が「Loading...」で
    // 固定される。
    return jsonError(502, { posts: [] });
  }

  return new Response(JSON.stringify({ posts }), { headers: JSON_HEADERS });
};
