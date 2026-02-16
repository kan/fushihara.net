export interface ZennArticle {
  title: string;
  path: string;
  emoji: string;
  published_at: string;
}

export interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  fork: boolean;
}

export async function fetchZennArticles(username: string, limit = 5): Promise<ZennArticle[]> {
  // Use local proxy to avoid CORS (Cloudflare Pages Function)
  const res = await fetch(
    `/api/zenn?username=${username}&count=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.articles ?? []).slice(0, limit);
}

export interface GitHubLanguage {
  name: string;
  count: number;
}

export async function fetchGitHubLanguages(username: string, limit = 5): Promise<GitHubLanguage[]> {
  const res = await fetch(
    `/api/github-languages?username=${username}&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.languages ?? [];
}

export async function fetchGitHubRepos(username: string, limit = 5): Promise<GitHubRepo[]> {
  // Use local proxy to avoid rate limits and leverage edge cache (Cloudflare Pages Function)
  const res = await fetch(
    `/api/github?username=${username}&count=${limit * 2}`
  );
  if (!res.ok) return [];
  const repos: GitHubRepo[] = await res.json();
  // Exclude forks, take top N
  return repos.filter((r) => !r.fork).slice(0, limit);
}
