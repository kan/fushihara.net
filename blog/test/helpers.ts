import { env } from 'cloudflare:test';
import { lily } from '../src/config.ts';
import { MOUNT_PATH, SITE } from '../src/site/meta.ts';

/**
 * **ここで見るのは fushihara.net の配線だけ。**
 *
 * CMS そのもの（ルーティング・フィード・管理 API・テーマの差し替え可能性）は
 * lily 側のテストが見ている。こちらが確かめるのは、本番の設定が意図どおりに
 * 組まれているか —— Access の選ばれ方、cron の配線、自前テーマが出す HTML、
 * 本体サイトと共有している日付関数との一致。
 *
 * **lily の内側（`src/core/db/` など）には手を伸ばさない。** 公開 API
 * (`@kanf/lily`) から見えないものに依存すると、パッケージの境界が意味を失う。
 */
export const ORIGIN = SITE.url;
export const MOUNT = MOUNT_PATH;

/** 本番と同じ設定で組んだアプリ。 */
export async function get(path: string): Promise<Response> {
  return await lily.fetch(new Request(`${ORIGIN}${path}`), env);
}
