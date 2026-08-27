/**
 * lily の入口。設定を渡すと Hono アプリが返る。
 *
 * **公開側のルータは最後に登録する。** `<mount>/*` の catch-all を持っているので、
 * 先に置くと `rss.xml` や `media/…` を飲み込んでしまう。
 */
import { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from './config.ts';
import { adminRoutes } from './routes/admin.ts';
import { apiRoutes, type AppEnv } from './routes/api.ts';
import { feedRoutes } from './routes/feeds.ts';
import { mediaRoutes } from './routes/media.ts';
import { createNotFound } from './routes/not-found.ts';
import { publicRoutes } from './routes/public.ts';

export function createLily<Bindings extends LilyBindings>(
  config: LilyConfig<Bindings>,
): Hono<AppEnv<Bindings>> {
  const app = new Hono<AppEnv<Bindings>>();
  // **保護境界を最初に置く。** api / admin へのミドルウェアが、後から来る
  // どのルータよりも先に走る。
  app.route('/', apiRoutes(config));
  // 管理画面の配信は保護のうしろ。api より後に置くのは、api の use が
  // <mount>/admin/* にも掛かっているのを先に走らせるため。
  app.route('/', adminRoutes(config));
  app.route('/', feedRoutes(config));
  app.route('/', mediaRoutes(config));
  app.route('/', publicRoutes(config));
  // サブアプリの notFound は親に引き継がれないので、ここでも設定する。
  app.notFound(createNotFound(config));
  return app;
}
