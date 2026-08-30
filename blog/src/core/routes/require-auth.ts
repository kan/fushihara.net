/**
 * 認証のミドルウェア。
 */
import type { Env, MiddlewareHandler } from 'hono';
import type { AuthAdapter, AuthUser } from '../auth/index.ts';
import type { LilyBindings } from '../config.ts';

/** このミドルウェアが要求する最低限の形。`api.ts` の `ApiEnv` がこれを満たす。 */
type AuthedEnv<Bindings extends LilyBindings> = Env & {
  Bindings: Bindings;
  Variables: { user: AuthUser };
};

/**
 * `adapterFor` は `env` からアダプタを作る。deployment 固有の設定
 * (Access のチーム名や AUD) を持ち回すのに、これ以外の経路を作らない。
 *
 * **失敗の理由はレスポンスに載せない。** 「どこまで合っていたか」を教えることに
 * なるため、ログにだけ出す。
 */
export function requireAuth<Bindings extends LilyBindings>(
  adapterFor: (env: Bindings) => AuthAdapter,
  onFailure: () => Response,
): MiddlewareHandler<AuthedEnv<Bindings>> {
  return async (c, next) => {
    const adapter = adapterFor(c.env);
    const result = await adapter.authenticate(c.req.raw);
    if (!result.ok) {
      console.warn(`auth: ${adapter.name} が拒否した (${c.req.path}): ${result.reason}`);
      return onFailure();
    }
    c.set('user', result.user);
    await next();
  };
}
