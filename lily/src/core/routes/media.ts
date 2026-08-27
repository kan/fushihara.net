/**
 * 添付の配信。`<mount>/media/<public_id>/<filename>`。
 *
 * 原本は R2 にあり、この route は D1 の `media` 行を引いて R2 のキーに読み替える。
 * **Cloudflare Images を使うかどうかに関わらず URL は同じ**で、最適化はこの
 * ハンドラの内側で振り分ける (今はまだ原本をそのまま返すだけ)。
 */
import { Hono } from 'hono';
import type { LilyBindings, PageConfig } from '../config.ts';
import { getMediaByPublicId } from '../db/media.ts';
import { createUrls } from '../paths.ts';
import { ROUTE } from './fixed.ts';

type Env = { Bindings: LilyBindings };

/**
 * media の URL は **不変**。ファイルを差し替えるときは行ごと作り直すので
 * `public_id` が変わり、URL も変わる。だから長期キャッシュしてよい。
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** 画像が無いときに HTML の 404 ページを返しても仕方がないので、素で返す。 */
const missing = (): Response => new Response('Not Found', { status: 404 });

export function mediaRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const urls = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath });
  const mount = urls.mountPath;

  app.get(`${mount}/${ROUTE.media}/:publicId/:filename`, async (c) => {
    const media = await getMediaByPublicId(c.env.DB, c.req.param('publicId'));
    // ファイル名まで一致を要求する。URL に出ている名前と中身が食い違うと、
    // 保存したときのファイル名が変わってしまう。
    if (!media || media.filename !== c.req.param('filename')) return missing();

    const object = await c.env.MEDIA.get(media.r2_key);
    if (!object) return missing();

    // Content-Length は付けない。D1 の `bytes` と R2 の実体がずれたときに嘘を
    // 返すことになるし、固定長のストリームなのでランタイムが正しく付ける。
    return new Response(object.body, {
      headers: {
        'Content-Type': media.mime,
        'Cache-Control': IMMUTABLE,
        ETag: object.httpEtag,
        // 記事に貼る SVG も配るので、**直接開かれたとき**にスクリプトが走らない
        // ようにする (<img> での埋め込みには影響しない)。同一オリジンで
        // 自分が上げたものを配る以上、置いておくのが安い。
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  return app;
}
