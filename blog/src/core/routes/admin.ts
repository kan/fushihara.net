/**
 * 管理画面の配信。中身は `src/admin/` の Vue で、ビルド成果物を静的アセットと
 * して置いてある。
 *
 * **保護は `routes/api.ts` が先に掛けている。** ここに届く時点で認証済み。
 */
import { Hono } from 'hono';
import { ADMIN_HINT, ADMIN_HINT_MAX_AGE, SITE_META, type AdminSiteMeta } from '../admin-contract.ts';
import type { LilyBindings, PageConfig } from '../config.ts';
import { createUrls, siteOrigin } from '../paths.ts';
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

  // 入口 HTML に差し込む値。設定はデプロイのときにしか変わらないので 1 度だけ組む。
  //
  // **サイト設定をそのまま渡す。** 項目を選び直すと、`SiteConfig` に足したものが
  // 設定画面に届かない。origin だけは URL を組む側と同じ正規化を通す。
  const siteMeta: AdminSiteMeta = { ...config.site, url: siteOrigin(config.site.url) };
  const siteMetaJson = JSON.stringify(siteMeta);
  // 「どのブログの管理画面か」が分かる題にする。管理画面を複数開いたときに
  // タブが全部 `lily` だと見分けが付かない。
  const title = `${config.site.name} - lily`;

  // **差し込むのは配信時。** ビルド時に焼かないのは、管理画面の成果物を deployment に
  // 依存させないため (`src/admin/api.ts` の `MOUNT` と同じ理由で、`/blog` と
  // `/blog-next` に同じものを配れる)。焼くと mount ごとにビルドが要る。
  const rewriter = new HTMLRewriter()
    .on('title', {
      element(element) {
        // setInnerContent は既定でテキストとして扱う (エスケープはこちらでしない)。
        element.setInnerContent(title);
      },
    })
    .on(`meta[name="${SITE_META}"]`, {
      element(element) {
        // 属性値のエスケープも rewriter の仕事。JSON を手で埋め込まない。
        element.setAttribute('content', siteMetaJson);
      },
    });

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

    // **HTML のときだけ書き換える。** JS や CSS を HTMLRewriter に流すと、中身の
    // `<` が要素の始まりとして解釈されて壊れる。
    //
    // ヘッダは Response を組む**前**に決めきること。`new Response()` は渡された
    // Headers を写すので、あとから append しても出て行くものは変わらない。
    const html = isHtml(headers);
    // 入口 HTML にだけ目印を付ける。アセットのたびに送っても増えるものは無い。
    if (html) headers.append('Set-Cookie', adminHint(c.req.url, mount));

    const output = new Response(response.body, { status: response.status, headers });
    return html ? rewriter.transform(output) : output;
  });

  return app;
}

/**
 * 目印の Set-Cookie。
 *
 * **HttpOnly を付けない** (公開ページの JS が読むためのもの)。`SameSite=Lax` は
 * 他所のサイトからの遷移で送られないようにするため。https のときだけ `Secure` を
 * 付けるのは、E2E とローカルが http だから (本番は必ず https)。
 */
function adminHint(requestUrl: string, mount: string): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_HINT}; Path=${mount}/; Max-Age=${ADMIN_HINT_MAX_AGE}; SameSite=Lax${secure}`;
}

function isHtml(headers: Headers): boolean {
  return (headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html');
}
