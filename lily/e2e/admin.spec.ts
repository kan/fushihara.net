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

test.describe('編集画面', () => {
  /** 下書きのフィクスチャ。タグが付いていないので候補が全部出る。 */
  async function openDraft(page: import('@playwright/test').Page): Promise<void> {
    await page.goto(`${MOUNT}/admin/#/posts/${ID.draft}`);
    await expect(page.locator('input[type="text"]').first()).toHaveValue('下書きの例');
  }

  test('タグの候補は 2 つ目以降も選べる', async ({ page }) => {
    // 選んだあとに候補を閉じると、`focus()` では focus イベントが出ない (既に
    // 当たっているため) ので、2 つ目を選ぶのに一度どこかへ外して戻る必要が出る。
    await openDraft(page);

    const draft = page.locator('.tag-input input');
    const suggestions = page.locator('.tag-input .suggest li');
    await draft.click();
    await expect(suggestions).toHaveCount(2);

    await suggestions.first().click();
    await expect(page.locator('.tag-input .chip')).toHaveCount(1);

    // ここで閉じていたら、続けて選べない。
    await expect(suggestions).toHaveCount(1);
    await suggestions.first().click();
    await expect(page.locator('.tag-input .chip')).toHaveCount(2);
  });

  test('リンクの URL 欄に貼った URL は展開しない', async ({ page }) => {
    await openDraft(page);
    const area = page.locator('.dropzone textarea');

    // 題を取りに行く先は止める。外へ出ると遅くなるうえ、相手の応答で結果が変わる。
    await page.route(`**${MOUNT}/api/link-title`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"title":null}' }),
    );

    /** カーソルを `at` に置いて URL を貼り、**既定の貼り付けを止めたか**を返す。 */
    async function paste(body: string, at: number): Promise<boolean> {
      await area.fill(body);
      return await area.evaluate((element, index) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(index, index);
        const data = new DataTransfer();
        data.setData('text/plain', 'https://example.com/x');
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        textarea.dispatchEvent(event);
        return event.defaultPrevented;
      }, at);
    }

    // `[題](https://)` の URL 欄。包むと `[題]([url](url))` になる。合成した
    // イベントでは既定の貼り付けが起きないので、**止めなかったこと**で見る。
    expect(await paste('[題](https://)', '[題]('.length)).toBe(false);
    await expect(area).toHaveValue('[題](https://)');

    // 本文の途中なら今までどおり `[url](url)` に包む。
    expect(await paste('ここに ', 4)).toBe(true);
    await expect(area).toHaveValue('ここに [https://example.com/x](https://example.com/x)');
  });

  test('説明を空にすると本文の冒頭が下に見える', async ({ page }) => {
    // 見えているものが、そのまま一覧・OGP・フィードに出る (配信側と同じ関数)。
    await openDraft(page);
    const description = page.locator('label', { hasText: '説明' }).locator('input');
    await description.fill('');
    await page.locator('.dropzone textarea').fill('自動で出る書き出し。\n\n次の段落。');
    await expect(description).toHaveAttribute('placeholder', '自動で出る書き出し。');
  });

  test('セッションが切れたら書きかけを退避して読み込み直す', async ({ page }) => {
    await openDraft(page);
    await page.locator('.dropzone textarea').fill('セッションが切れる直前の本文。');

    // 保存の 1 往復だけ Access が切れた形にする。読み込み直したあとの取得は通す。
    await page.route(`**${MOUNT}/api/posts/**`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      }),
      { times: 1 },
    );

    await page.getByRole('button', { name: '保存' }).click();

    // 読み込み直したうえで、保存できていなかった本文が戻っている。
    await expect(page.locator('.notice', { hasText: '復元した' })).toBeVisible();
    await expect(page.locator('.dropzone textarea')).toHaveValue('セッションが切れる直前の本文。');

    // 通ったなら数え直す。次に切れたときもまた 1 回目から読み込み直せる。
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('lily:reload-attempt')))
      .toBeNull();
  });

  test('読み込み直しても直らなければ止まる（無限に読み込み直さない）', async ({ page }) => {
    // リロードで直らない拒否 (Access のポリシーから外れた / AUD 設定違い) を
    // 時間で見分けようとすると、ログインの往復が長いだけで判定が失効する。
    await page.route(`**${MOUNT}/api/**`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      }),
    );

    await page.goto(`${MOUNT}/admin/#/posts/${ID.draft}`);
    // 読み込み直しが止まっていなければ、この文字は出る前に流れ続ける。
    await expect(page.locator('.notice.error')).toContainText('forbidden');

    // **時間ではなく回数で覚えている。** 経過時間で見分けると、Access の
    // ログイン (MFA を含む) が長引いただけで判定が失効して数え直しになる。
    expect(await page.evaluate(() => sessionStorage.getItem('lily:reload-attempt'))).toBe('1');
  });

  test('読み込み直しても直らないときでも書きかけは戻ってくる', async ({ page }) => {
    await openDraft(page);
    await page.locator('.dropzone textarea').fill('直らない側の本文。');

    await page.route(`**${MOUNT}/api/**`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      }),
    );
    await page.getByRole('button', { name: '保存' }).click();

    // 読み込み直した先でも 403 なので記事は出ない。**それでも控えは残る。**
    await expect(page.locator('.notice.error')).toContainText('forbidden');
    await expect(page.locator('.dropzone textarea')).toHaveValue('直らない側の本文。');
  });

  test('退避した画面は 1 度しか使わない（あとで開いた管理画面を乗っ取らない）', async ({
    page,
  }) => {
    // `location.reload()` はフラグメントを保つので、退避が消費されないまま
    // 残ることがある。
    await page.goto(`${MOUNT}/admin/#/settings`);
    await page.evaluate((hash) => sessionStorage.setItem('lily:route', hash), `/posts/${ID.draft}`);

    // ハッシュ付きで開いた回では、退避は使われない (が、消費はされる)。
    // **公開ページを挟む。** ハッシュだけ違う URL へ移っても読み込み直さない。
    await page.goto(url.index());
    await page.goto(`${MOUNT}/admin/#/settings`);
    await expect(page).toHaveURL(`${MOUNT}/admin/#/settings`);

    await page.goto(url.index());
    await page.goto(`${MOUNT}/admin/`);
    await expect(page).toHaveURL(`${MOUNT}/admin/`);
  });

  test('読み込み直しでフラグメントが落ちても開いていた画面へ戻る', async ({ page }) => {
    // Access のログインを経由すると `#` はサーバーへ送られないので、戻ってきた
    // URL は `<mount>/admin/` になる。退避しておいた画面へ寄せ直す。
    await page.goto(`${MOUNT}/admin/`);
    await page.evaluate((hash) => sessionStorage.setItem('lily:route', hash), `/posts/${ID.draft}`);

    await page.goto(`${MOUNT}/admin/`);
    await expect(page).toHaveURL(`${MOUNT}/admin/#/posts/${ID.draft}`);
    await expect(page.locator('input[type="text"]').first()).toHaveValue('下書きの例');
  });
});
