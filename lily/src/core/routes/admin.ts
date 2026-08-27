/**
 * 管理画面の配信。中身は `src/admin/` の Vue で、ビルド成果物を静的アセットと
 * して置いてある。
 *
 * **保護は `routes/api.ts` が先に掛けている。** ここに届く時点で認証済み。
 */
import { Hono } from 'hono';
import type { LilyBindings, PageConfig } from '../config.ts';
import { createUrls } from '../paths.ts';
import { ROUTE } from './fixed.ts';

type Env = { Bindings: LilyBindings };

/**
 * 認証の向こう側なので、共有キャッシュに残さない。ブラウザには ETag で
 * 確かめさせる (アセット名にハッシュが入っているので実際にはほぼ 304)。
 */
const PRIVATE = 'private, max-age=0, must-revalidate';

/** vite が出す成果物の置き場所 (`build.outDir` の中)。 */
const ASSET_DIR = 'assets';

export function adminRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const mount = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath }).mountPath;
  const base = `${mount}/${ROUTE.admin}`;

  app.get(base, (c) => c.redirect(`${base}/`, 308));

  app.get(`${base}/*`, async (c) => {
    // 静的アセットの URL はディレクトリ直下からの相対なので、mount を落として渡す。
    const rest = c.req.path.slice(base.length + 1);
    const asset = await c.env.ASSETS.fetch(new URL(`/admin/${rest || 'index.html'}`, c.req.url));

    // 見つからないパスは SPA の入口に寄せる。画面の切り替えはハッシュで行うので
    // 普通は来ないが、リロードやブックマークで直接叩かれたときに 404 にしない。
    //
    // **ビルド成果物は寄せない。** デプロイをまたいで開いていたタブが古い
    // ハッシュ付きの JS を取りに来たとき、HTML を 200 で返すと MIME の不一致で
    // 白い画面になる（404 なら原因が分かる）。
    const response =
      asset.status === 404 && !rest.startsWith(`${ASSET_DIR}/`)
        ? await c.env.ASSETS.fetch(new URL('/admin/index.html', c.req.url))
        : asset;

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', PRIVATE);
    headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { status: response.status, headers });
  });

  return app;
}
