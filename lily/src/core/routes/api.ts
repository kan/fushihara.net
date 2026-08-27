/**
 * 管理 API と管理画面の**保護境界**。
 *
 * `<mount>/api/*` と `<mount>/admin/*` はここを通らないと届かない。API の中身は
 * `core/api/` にあり、**mount を知らない形**でマウントされる (Hono RPC の型が
 * リテラルのまま残るので、管理画面は `hc<LilyApi>('<mount>/api')` だけで済む)。
 */
import { Hono } from 'hono';
import { createApi, type ApiEnv } from '../api/index.ts';
import type { LilyBindings, LilyConfig } from '../config.ts';
import { createUrls } from '../paths.ts';
import { ROUTE } from './fixed.ts';
import { requireAuth } from './require-auth.ts';

export type AppEnv<Bindings extends LilyBindings> = {
  Bindings: Bindings;
  Variables: ApiEnv['Variables'];
};

export function apiRoutes<Bindings extends LilyBindings>(
  config: LilyConfig<Bindings>,
): Hono<AppEnv<Bindings>> {
  const app = new Hono<AppEnv<Bindings>>();
  const mount = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath }).mountPath;

  // **中身より先に掛ける。** 未実装のパスも 403 で返るので、route を足したときに
  // 保護を忘れる余地が無い。
  app.use(`${mount}/${ROUTE.api}/*`, requireAuth(config.auth, jsonForbidden));
  app.use(`${mount}/${ROUTE.admin}/*`, requireAuth(config.auth, textForbidden));

  app.route(`${mount}/${ROUTE.api}`, createApi(config));

  return app;
}

const jsonForbidden = (): Response =>
  Response.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });

const textForbidden = (): Response =>
  new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
