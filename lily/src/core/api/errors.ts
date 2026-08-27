/**
 * API のエラー。**形を 1 つに揃える。**
 *
 * 管理画面は `error` のコードだけを見て分岐し、`message` は人が読むためのもの。
 * query layer が返す `Result` のコードをそのまま載せるので、DB 側の判断と
 * API の応答が食い違わない。
 */
export type ApiError = { readonly error: string; readonly message?: string };

/**
 * この API が返す失敗はこの 3 つだけ。
 *
 * **広い `ContentfulStatusCode` にしない。** Hono RPC はステータスから
 * レスポンスの型を絞るので、200 が混じった型だと管理画面側で
 * `if (res.ok)` の絞り込みが効かなくなる。
 */
export type ApiErrorStatus = 400 | 404 | 409;

/** パスやタグの衝突は 409、形が違うものは 400、無いものは 404。 */
export function statusFor(code: string): ApiErrorStatus {
  if (code === 'post-not-found' || code === 'not-found') return 404;
  if (
    code === 'path-taken' ||
    code === 'public-id-taken' ||
    code === 'slug-taken' ||
    code === 'filename-taken'
  ) {
    return 409;
  }
  return 400;
}

export function apiError(code: string, message?: string): [ApiError, ApiErrorStatus] {
  return [{ error: code, ...(message === undefined ? {} : { message }) }, statusFor(code)];
}
