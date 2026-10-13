export interface BlogPost {
  title: string;
  link: string;
  /** ISO 8601。RSS の pubDate が読めなかったときは空文字 */
  date: string;
}

export interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  fork: boolean;
}

/** 取れた一覧と、その出どころ */
export interface Fetched<T> {
  items: T[];
  /**
   * 上流が落ちていて、Worker が前に取れた控えを返した（`X-Backup: hit`）。
   * 付箋の下の「どこから来たか」の表示が読む
   */
  backup: boolean;
}

/**
 * Worker のプロキシを叩く。失敗は握り潰して null を返す規約で、呼び出し側は
 * 空を返す。カードを更新しなければ board-data.ts の静的テキストが残るため。
 */
async function getJson<T>(path: string): Promise<{ data: T; backup: boolean } | null> {
  const res = await fetch(path);
  if (!res.ok) return null;
  return { data: await res.json(), backup: res.headers.get('X-Backup') === 'hit' };
}

/** ブログ (/blog) の新着記事。Worker が RSS を JSON に均してくれる */
export async function fetchBlogPosts(limit = 5): Promise<BlogPost[]> {
  const res = await getJson<{ posts?: BlogPost[] }>(`/api/blog?count=${limit}`);
  return res?.data.posts ?? [];
}

export interface GitHubLanguage {
  name: string;
  count: number;
}

export async function fetchGitHubLanguages(
  username: string,
  limit = 5,
): Promise<Fetched<GitHubLanguage>> {
  const res = await getJson<{ languages?: GitHubLanguage[] }>(
    `/api/github-languages?username=${username}&limit=${limit}`,
  );
  return { items: res?.data.languages ?? [], backup: !!res?.backup };
}

/**
 * 非 fork のリポジトリ一覧。どれを出すかは呼び出し側（`OSS_REPOS`）が決めるので、
 * ここでは絞らない。名前で引けるよう、上限いっぱい（100 件）まで取ってくる。
 */
export async function fetchGitHubRepos(
  username: string,
  count = 100,
): Promise<Fetched<GitHubRepo>> {
  const res = await getJson<GitHubRepo[]>(`/api/github?username=${username}&count=${count}`);
  return { items: (res?.data ?? []).filter((r) => !r.fork), backup: !!res?.backup };
}
