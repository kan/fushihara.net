/**
 * Worker のエントリ。公開側の SSR と管理 API はこれから載せる。
 *
 * 今は wrangler の設定を成立させるための最小の入口で、まだ何も配っていない。
 */
export default {
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
