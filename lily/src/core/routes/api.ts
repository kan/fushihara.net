/**
 * 管理 API と管理画面の**保護境界**。
 *
 * `<mount>/api/*` と `<mount>/admin/*` はここを通らないと届かない。中身
 * (CRUD と Vue の管理画面) はこれから足すが、**先に守りを置いてから**中身を
 * 入れる。逆順にすると、守り忘れた期間が生まれる。
 */
import { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from '../config.ts';
import type { AuthUser } from '../auth/index.ts';
import { createUrls } from '../paths.ts';
import { ROUTE } from './fixed.ts';
import { requireAuth } from './require-auth.ts';

export type ApiEnv<Bindings extends LilyBindings> = {
  Bindings: Bindings;
  Variables: { user: AuthUser };
};

export function apiRoutes<Bindings extends LilyBindings>(
  config: LilyConfig<Bindings>,
): Hono<ApiEnv<Bindings>> {
  const app = new Hono<ApiEnv<Bindings>>();
  const mount = createUrls({ siteUrl: config.site.url, mountPath: config.mountPath }).mountPath;

  // **中身が無くても先に掛ける。** 未実装のパスも 403 で返るので、
  // route を足したときに保護を忘れる余地が無い。
  app.use(`${mount}/${ROUTE.api}/*`, requireAuth(config.auth, jsonForbidden));
  app.use(`${mount}/${ROUTE.admin}/*`, requireAuth(config.auth, textForbidden));

  /** 管理画面が「誰として入っているか」を確かめるための唯一の入口。 */
  app.get(`${mount}/${ROUTE.api}/me`, (c) => c.json({ user: c.get('user') }));

  return app;
}

const jsonForbidden = (): Response =>
  Response.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });

const textForbidden = (): Response =>
  new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
