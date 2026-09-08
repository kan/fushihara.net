/**
 * 認証の差し替え点。**core は認証の方式を 1 つも知らない。**
 *
 * fushihara.net は Cloudflare Access アダプタ (`auth/access.ts`) を使うが、
 * Deploy to Cloudflare は Access を自動プロビジョニングできないので、OSS の
 * 標準構成では別のアダプタが既定になる。だから core に Access を焼き付けない。
 */

export type AuthUser = {
  /** 一意な識別子。Access なら JWT の `sub`。 */
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
};

export type AuthResult =
  | { readonly ok: true; readonly user: AuthUser }
  /**
   * 失敗の理由。**そのままレスポンスに載せない。** 攻撃者に「どこまで合っていたか」
   * を教えることになるので、ログや開発用に留める。
   */
  | { readonly ok: false; readonly reason: string };

export interface AuthAdapter {
  /** アダプタの名前。ログと診断用。 */
  readonly name: string;
  authenticate(request: Request): Promise<AuthResult>;
}

/** リクエストから Cookie を 1 つ取り出す。アダプタから使う小物。 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
