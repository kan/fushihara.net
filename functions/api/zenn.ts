export const onRequestGet: PagesFunction = async ({ request }) => {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const url = new URL(request.url);
  const username = url.searchParams.get('username') ?? '';
  const count = url.searchParams.get('count') ?? '5';

  const apiUrl = `https://zenn.dev/api/articles?username=${encodeURIComponent(username)}&order=latest&count=${encodeURIComponent(count)}`;
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'fushihara-net-portfolio' },
  });

  const response = new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });

  if (res.ok) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
};
