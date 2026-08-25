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
  stargazers_count: number;
  language: string | null;
  fork: boolean;
}

/**
 * Worker のプロキシを叩く。失敗は握り潰して null を返す規約で、呼び出し側は
 * 空を返す。カードを更新しなければ board-data.ts の静的テキストが残るため。
 */
async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  if (!res.ok) return null;
  return res.json();
}

/** ブログ (/blog) の新着記事。Worker が RSS を JSON に均してくれる */
export async function fetchBlogPosts(limit = 5): Promise<BlogPost[]> {
  const data = await getJson<{ posts?: BlogPost[] }>(`/api/blog?count=${limit}`);
  return data?.posts ?? [];
}

export interface GitHubLanguage {
  name: string;
  count: number;
}

export async function fetchGitHubLanguages(username: string, limit = 5): Promise<GitHubLanguage[]> {
  const data = await getJson<{ languages?: GitHubLanguage[] }>(
    `/api/github-languages?username=${username}&limit=${limit}`,
  );
  return data?.languages ?? [];
}

export async function fetchGitHubRepos(username: string, limit = 5): Promise<GitHubRepo[]> {
  // fork を落としてから上位 N 件にするので、多めに要求しておく
  const repos = await getJson<GitHubRepo[]>(`/api/github?username=${username}&count=${limit * 2}`);
  return (repos ?? []).filter((r) => !r.fork).slice(0, limit);
}
