import { expect, test } from '@playwright/test';
import { SITE } from '../src/site/meta.ts';
import { ID, MOUNT, url } from './helpers.ts';

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

test.describe('見出しと設定', () => {
  test('題と見出しはサイト名 (どのブログの管理画面か分かる)', async ({ page }) => {
    // 差し込むのは配信時 (`core/routes/admin.ts`)。ビルド成果物には `lily` しか
    // 入っていないので、これが落ちたら差し込みが外れている。
    await page.goto(`${MOUNT}/admin/`);
    await expect(page).toHaveTitle(`${SITE.name} - lily`);
    await expect(page.locator('header.bar h1')).toHaveText(SITE.name);
  });

  test('設定はソースの値を表示するだけ', async ({ page }) => {
    await page.goto(`${MOUNT}/admin/`);
    await page.getByRole('link', { name: '設定' }).click();

    const settings = page.locator('.settings');
    await expect(settings).toContainText(SITE.name);
    await expect(settings).toContainText(SITE.author);
    // **公開 URL はマウントまで込みで 1 つ**。分けて出すと、実際に配信されている
    // URL がどれなのか読み取れない。マウントの部分だけ太字にしてある。
    await expect(settings).toContainText(`${SITE.url}${MOUNT}`);
    await expect(settings.locator('dd strong')).toHaveText(MOUNT);
    // 変更する口は無い。ここに入力欄が生えたら、この画面の前提が変わっている。
    await expect(page.locator('.settings input, .settings button')).toHaveCount(0);
  });
});

test.describe('一覧の絞り込み', () => {
  test('キーワードでタイトルからも本文からも引ける', async ({ page }) => {
    await page.goto(`${MOUNT}/admin/`);
    const rows = page.locator('.post-row');
    // **数える前に描画を待つ。** `count()` は待たないので、読み込み中に数えると 0。
    await expect(rows.first()).toBeVisible();
    const all = await rows.count();
    expect(all).toBeGreaterThan(1);

    await page.getByLabel('記事を検索').fill('同じ日の朝');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('同じ日の朝');

    // 本文にしか無い語。**タイトルだけを見ていたらここで落ちる。**
    await page.getByLabel('記事を検索').fill('早朝');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('同じ日の朝');

    await page.getByRole('button', { name: '絞り込みを解除' }).click();
    await expect(rows).toHaveCount(all);
  });

  test('タグで絞れる (行のタグを押しても同じ)', async ({ page }) => {
    await page.goto(`${MOUNT}/admin/`);
    const rows = page.locator('.post-row');

    await page.getByLabel('タグで絞り込む').selectOption('sample');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('描画サンプル');

    await page.getByRole('button', { name: '絞り込みを解除' }).click();
    // 行に出ているタグを押すと、そのタグで絞り込む。
    await rows.first().getByRole('button', { name: 'fixture で絞り込む' }).first().click();
    await expect(page.getByLabel('タグで絞り込む')).toHaveValue('fixture');
    await expect(rows.first()).toBeVisible();
  });

  test('遅れて返った古い検索結果で上書きしない', async ({ page }) => {
    // 検索は本文への LIKE 全走査なので、**短い語ほど遅い**。打鍵の途中で投げた
    // 「同」が、確定した「同じ日の朝」より後に返ると、入力欄と一覧が食い違った
    // まま固まる。ここでは前者だけを遅らせて、その状況を作る。
    await page.route('**/api/posts?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') === '同') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await page.goto(`${MOUNT}/admin/`);
    const rows = page.locator('.post-row');
    await expect(rows.first()).toBeVisible();

    const search = page.getByLabel('記事を検索');
    await search.fill('同');
    await page.waitForTimeout(400); // デバウンス (250ms) を越えて 1 本目を飛ばす
    await search.fill('同じ日の朝');
    await expect(rows).toHaveCount(1);

    // 遅れて返る「同」(4 件) を捨てていること。捨てないとここで増える。
    await page.waitForTimeout(1800);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('同じ日の朝');
  });

  test('状態で絞ると下書きだけになる', async ({ page }) => {
    await page.goto(`${MOUNT}/admin/`);
    await page.getByLabel('状態で絞り込む').selectOption('draft');
    const rows = page.locator('.post-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('下書きの例');
  });
});

test.describe('公開ページの管理リンク', () => {
  test('管理画面を開いた端末にだけ出て、その記事の編集画面へ行ける', async ({ page }) => {
    const link = page.locator('.admin-link');

    // まだ管理画面を開いていない端末には出ない (HTML には最初からある)。
    await page.goto(url.post('rendering-sample'));
    await expect(link).toBeAttached();
    await expect(link).toBeHidden();

    // 管理画面を開くと目印の cookie が付く。
    await page.goto(`${MOUNT}/admin/`);
    await page.goto(url.post('rendering-sample'));
    await expect(link).toBeVisible();

    // **押して確かめる。** ハッシュの形 (`#/posts/<public_id>`) は
    // `src/site/layout.ts` と `src/admin/router.ts` の 2 箇所にあるので、
    // 食い違うと一覧が開くだけで気付けない。
    await link.click();
    await expect(page).toHaveURL(`${MOUNT}/admin/#/posts/${ID.renderingSample}`);
    await expect(page.locator('input[type="text"]').first()).toHaveValue('描画サンプル');
  });

  test('一覧からは管理画面のトップへ行く', async ({ page }) => {
    await page.goto(`${MOUNT}/admin/`);
    await page.goto(`${MOUNT}/`);
    const link = page.locator('.admin-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `${MOUNT}/admin/`);
  });
});
