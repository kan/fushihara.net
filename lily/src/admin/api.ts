/**
 * 管理 API のクライアント。**型は core から来る。**
 *
 * `import type` なので実装は 1 バイトも混ざらない。エンドポイントを変えると
 * ここではなく呼び出し側がコンパイルエラーになる。
 */
import { hc } from 'hono/client';
import type { LilyApi } from '../core/api/index.ts';

/**
 * マウント位置。管理画面は `<mount>/admin/` に置かれるので、そこから割り出す。
 *
 * ビルド時に焼き付けないのは、`/blog` と `/blog-next` の両方で同じ成果物を
 * 使えるようにするため (`vite.config.ts` の `base: './'` と対)。
 */
export const MOUNT = location.pathname.replace(/\/admin(\/.*)?$/, '');

/**
 * base は**絶対 URL**にする。`$url()` が URL を組み立てるのに要るので、相対だと
 * 画像のアップロード (multipart で `$url()` を使う経路) が `Invalid URL` で落ちる。
 */
export const client = hc<LilyApi>(`${location.origin}${MOUNT}/api`);

/**
 * API のエラーを人に見せる文にする。
 *
 * 引数を `Response` ではなく構造で受けるのは、`hc` が返すのが素の `Response` では
 * なく型付きの `ClientResponse` だから。
 */
export async function errorMessage(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message ? `${body.error}: ${body.message}` : (body.error ?? `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}
