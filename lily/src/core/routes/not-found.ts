/**
 * 404。ページのルータとアプリ全体の両方から使うので、生成をここに 1 つ置く。
 */
import type { LilyConfig } from '../config.ts';
import { createUrls } from '../paths.ts';
import { SHORT_EDGE } from './cache.ts';

export function createNotFound(config: LilyConfig): () => Promise<Response> {
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });

  return async () =>
    new Response(
      await config.theme.notFound({ site: config.site, urls, canonicalUrl: null }),
      {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': SHORT_EDGE },
      },
    );
}
