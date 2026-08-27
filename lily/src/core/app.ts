/**
 * lily の入口。設定を渡すと Hono アプリが返る。
 *
 * 今は公開側だけ。管理 API (`core/api`) と media の配信はここに足していく。
 */
import type { Hono } from 'hono';
import type { LilyBindings, LilyConfig } from './config.ts';
import { publicRoutes } from './routes/public.ts';

export function createLily(config: LilyConfig): Hono<{ Bindings: LilyBindings }> {
  return publicRoutes(config);
}
