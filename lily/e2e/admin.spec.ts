import { expect, test } from '@playwright/test';
import { MOUNT } from './helpers.ts';

/**
 * 管理画面の E2E。**`blog.spec.ts` とは分けてある。**
 *
 * あちらは「生成器を差し替えても入出力の契約は変わらない」を確かめるハーネスで、
 * HTTP と DOM から見えるものだけで合否を出す。管理画面は lily 固有なので、
 * 混ぜるとその線が消える。
 *
 * ローカルでは `ACCESS_TEAM` / `ACCESS_AUD` が空 (`.dev.vars`) なので
 * `localhostOnly` に落ちて開ける。本番は Cloudflare Access の内側。
 */
test.describe('管理画面', () => {
  test('一覧の日付は JST で出す', async ({ page }) => {
    // フィクスチャは 2026-08-20T08:00:00+09:00 = 2026-08-19T23:00:00Z。
    // **UTC のまま頭を 10 文字取ると 8/19 になる。** 公開ページと編集画面は JST
    // なので、一覧だけ 1 日ずれることになる (実際に踏んだ)。
    await page.goto(`${MOUNT}/admin/`);

    const row = page.locator('.post-row', { hasText: '同じ日の朝' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('2026-08-20');
    await expect(row).not.toContainText('2026-08-19');
  });

  test('公開ページと同じ日付が出る', async ({ page }) => {
    // 一覧だけ別実装にすると、片方を直した日にもう片方が置いていかれる。
    // **同じ記事の日付が 2 画面で一致していること**を直接見る。
    await page.goto(`${MOUNT}/order-time-a/`);
    const shown = await page.locator('article time').first().getAttribute('datetime');

    await page.goto(`${MOUNT}/admin/`);
    await expect(page.locator('.post-row', { hasText: '同じ日の朝' })).toContainText(
      shown as string,
    );
  });
});
