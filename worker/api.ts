// ブラウザから外部 API を直接叩かず、ここを経由させている。
// Zenn は CORS、GitHub はレートリミットの回避が理由。

const USER_AGENT = 'fushihara-net-portfolio';

// このプロキシはこのポートフォリオ専用。任意の username を通すと第三者が
// GitHub / Zenn の公開プロキシとして使えてしまい、Worker のリクエスト枠と
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
): (url: URL) => Promise<Response> {
  return async (url) => {
    const name = url.searchParams.get('username') ?? '';
    if (!ALLOWED_USERS.has(name)) {
      return new Response(JSON.stringify({ error: 'unsupported username' }), {
        status: 400,
        headers: ERROR_HEADERS,
      });
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

export const zenn = forAllowedUser(async (url, user) => {
  const count = positiveInt(url, 'count', 5, 100);

  return proxy(
    `https://zenn.dev/api/articles?username=${encodeURIComponent(user)}` +
      `&order=latest&count=${count}`,
    { 'User-Agent': USER_AGENT },
  );
});

export const githubRepos = forAllowedUser(async (url, user) => {
  const count = positiveInt(url, 'count', 10, 100);

  return proxy(repoListUrl(user, count), GITHUB_HEADERS);
});

/** 非 fork リポジトリの language を集計し、頻度順に上位 N 件を返す */
export const githubLanguages = forAllowedUser(async (url, user) => {
  const limit = positiveInt(url, 'limit', 5, 50);

  // 言語の傾向を掴むため最大 100 件のリポジトリを見る
  const res = await fetch(repoListUrl(user, 100), { headers: GITHUB_HEADERS });
  if (!res.ok) {
    return new Response(JSON.stringify({ languages: [] }), {
      status: res.status,
      headers: ERROR_HEADERS,
    });
  }

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
