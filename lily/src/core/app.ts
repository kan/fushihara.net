/**
 * lily の入口。設定を渡すと Hono アプリが返る。
 *
 * **公開側のルータは最後に登録する。** `<mount>/*` の catch-all を持っているので、
 * 先に置くと `rss.xml` や `media/…` を飲み込んでしまう。
 */
import { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from './config.ts';
import { feedRoutes } from './routes/feeds.ts';
import { mediaRoutes } from './routes/media.ts';
import { createNotFound } from './routes/not-found.ts';
import { publicRoutes } from './routes/public.ts';

export function createLily(config: LilyConfig): Hono<{ Bindings: LilyBindings }> {
  const app = new Hono<{ Bindings: LilyBindings }>();
  app.route('/', feedRoutes(config));
  app.route('/', mediaRoutes(config));
  app.route('/', publicRoutes(config));
  // サブアプリの notFound は親に引き継がれないので、ここでも設定する。
  app.notFound(createNotFound(config));
  return app;
}
