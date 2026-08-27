/**
 * D1 が投げる制約違反を、呼び出し側が分岐できる形に写像するための判定。
 *
 * 事前に SELECT で確かめてから INSERT する経路 (createPost / addAlias) は
 * check-then-act なので、同じパスを同時に作られると素の例外が漏れる。
 * DB の UNIQUE 違反も同じ `Result` のエラーに畳んで、呼び出し側から見た
 * 振る舞いを 1 つにする。
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
