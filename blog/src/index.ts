/**
 * Worker のエントリ。ルーティングと見た目は `config.ts` が組んだアプリが持つ。
 */
import { runBackup } from './core/backup.ts';
import { lily } from './config.ts';

/**
 * 残す控えの世代。**1 日 1 回なので約 1 か月。**
 *
 * 日数ではなく数で切っているのは、cron が止まっているあいだに全部が「古い」に
 * なって消えるのを防ぐため（`core/backup.ts`）。
 */
const KEEP_BACKUPS = 30;

export default {
  fetch: lily.fetch,

  /**
   * 毎日の控え取り。**失敗しても次の日にまた走る**ので、リトライはしない。
   *
   * `waitUntil` に逃がさず await するのは、失敗を scheduled の結果に出すため
   * （逃がすとハンドラは成功したことになり、ログを見に行くまで気付けない）。
   */
  async scheduled(_controller, env) {
    if (!env.BACKUP) {
      console.warn('lily backup: BACKUP バインディングが無いので何もしない');
      return;
    }
    const result = await runBackup(env.DB, env.MEDIA, env.BACKUP, { keep: KEEP_BACKUPS });
    console.info(
      `lily backup: ${result.key} (${result.bytes} bytes, posts=${result.posts}, ` +
        `media=${result.media}, warnings=${result.warnings}, deleted=${result.deleted.length})`,
    );
  },
} satisfies ExportedHandler<Env>;
