export const onRequestGet: PagesFunction = async ({ request }) => {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const url = new URL(request.url);
  const username = url.searchParams.get('username') ?? '';
  const limit = parseInt(url.searchParams.get('limit') ?? '5', 10);

  // Fetch up to 100 repos to get a good sample of languages
  const apiUrl = `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=100`;
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'fushihara-net-portfolio',
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ languages: [] }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const repos: { language: string | null; fork: boolean }[] = await res.json();

  // Count languages from non-fork repos
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (!r.fork && r.language) {
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
  }

  // Sort by frequency, take top N
  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));

  const body = JSON.stringify({ languages });
  const response = new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });

  await cache.put(cacheKey, response.clone());
  return response;
};
