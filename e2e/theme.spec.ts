import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEY } from '../shared/theme';

// 外部 API は描画待ちを安定させるためだけにモックする（内容は問わない）。
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (r) => r.fulfill({ json: { posts: [], languages: [] } }));
});

const toggle = (page: Page) => page.locator('.theme-toggle');

/** ルート要素の data-theme と、実際に描画されている背景色 */
async function themeState(page: Page) {
  return page.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
}

/**
 * 背景色には 0.25s の transition が掛かっているので、遷移が終わるまで待つ。
 * 途中の色を掴むと不安定なテストになる。
 */
function expectBackground(page: Page) {
  return expect.poll(async () => (await themeState(page)).bg, { timeout: 5_000 });
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.wema-note').first()).toBeVisible();
  await expect(toggle(page)).toBeVisible();
}

test.describe('OS 設定への追従', () => {
  test.use({ colorScheme: 'dark' });

  test('保存値が無ければ OS のダーク設定に従う', async ({ page }) => {
    await open(page);

    expect((await themeState(page)).attr).toBe('dark');
  });
});

test.describe('OS がライトのとき', () => {
  test.use({ colorScheme: 'light' });

  test('保存値が無ければライトで表示される', async ({ page }) => {
    await open(page);

    expect((await themeState(page)).attr).toBe('light');
    await expectBackground(page).toBe('rgb(245, 245, 247)');
  });

  test('保存された選択は OS 設定より優先される', async ({ page }) => {
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, 'dark'),
      [STORAGE_KEY] as const,
    );

    await open(page);

    expect((await themeState(page)).attr).toBe('dark');
  });
});

test.describe('切り替え', () => {
  test.use({ colorScheme: 'dark' });

  test('押すとテーマと背景色が実際に変わる', async ({ page }) => {
    await open(page);
    const before = await themeState(page);
    expect(before.attr).toBe('dark');

    await toggle(page).click();

    expect((await themeState(page)).attr).toBe('light');
    await expectBackground(page).toBe('rgb(245, 245, 247)');
    expect((await themeState(page)).bg).not.toBe(before.bg);
  });

  test('2 回押すと元に戻る', async ({ page }) => {
    await open(page);
    const before = await themeState(page);

    await toggle(page).click();
    await toggle(page).click();

    expect((await themeState(page)).attr).toBe(before.attr);
    await expectBackground(page).toBe(before.bg);
  });

  test('リロードしても選択が残る', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    expect((await themeState(page)).attr).toBe('light');

    await page.reload();
    await expect(toggle(page)).toBeVisible();

    expect((await themeState(page)).attr).toBe('light');
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY))
      .toBe('light');
  });

  test('アプリの JS を待たずに data-theme が確定する（ちらつき防止）', async ({ page }) => {
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, 'light'),
      [STORAGE_KEY] as const,
    );
    // モジュールスクリプトを落として、index.html の同期スクリプトだけで
    // テーマが決まることを確かめる。これが無いと保存テーマと OS 設定が違う
    // 訪問者に一瞬ちらつきが出る。
    await page.route('**/assets/*.js', (r) => r.abort());

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  });
});

test.describe('wema 由来の要素', () => {
  // モバイルは折りたたみエッジを全部開くのでバッジ自体が出ない
  test.skip(({ isMobile }) => !!isMobile, 'デスクトップ専用');

  // wema は折りたたみバッジを --wema-anchor-color から塗る。アンカーを隠すために
  // それを transparent にしているので、放っておくと素の板の上に白文字が乗り、
  // ライトテーマで消える。
  for (const scheme of ['dark', 'light'] as const) {
    test(`折りたたみバッジが ${scheme} でも背景に埋もれない`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);

      const badge = page.locator('.wema-note-collapse-badge').first();
      const { color, bg } = await badge.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
      });

      expect(color).not.toBe(bg);
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    });
  }
});

test.describe('アクセシビリティと堅牢性', () => {
  test('ボタンに状態を説明する aria-label が付き、押すと更新される', async ({ page }) => {
    await open(page);
    const label = await toggle(page).getAttribute('aria-label');
    expect(label).toBeTruthy();

    await toggle(page).click();

    expect(await toggle(page).getAttribute('aria-label')).not.toBe(label);
  });

  test('キーボードだけで操作できる', async ({ page }) => {
    await open(page);
    const before = (await themeState(page)).attr;

    await toggle(page).focus();
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Enter');

    expect((await themeState(page)).attr).not.toBe(before);
  });

  test('保存だけ失敗する環境でも、選んだテーマが OS 設定の変化で奪われない', async ({ page }) => {
    // Safari のプライベートモードや QuotaExceededError は
    // getItem は通るのに setItem だけ throw する。保存値だけで
    // 「明示的に選んだか」を判定していると、この後の OS テーマ変更で戻ってしまう。
    await page.addInitScript(() => {
      const real = window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => ({
          getItem: (k: string) => real.getItem(k),
          setItem: () => { throw new Error('quota exceeded'); },
          removeItem: (k: string) => real.removeItem(k),
        }),
      });
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    expect((await themeState(page)).attr).toBe('dark');

    await toggle(page).click();
    expect((await themeState(page)).attr).toBe('light');

    // 「変わらないこと」の確認なので、時間待ちにすると発火前に読んで
    // 偽陽性になる。アプリの後ろに同じリスナを足し、それが呼ばれ切ってから見る。
    await page.evaluate(() => {
      const w = window as unknown as { __mq?: MediaQueryList; __mqCount?: number };
      const mql = matchMedia('(prefers-color-scheme: dark)');
      w.__mqCount = 0;
      mql.addEventListener('change', () => { w.__mqCount = (w.__mqCount ?? 0) + 1; });
      // MediaQueryList を参照し続けないと GC でリスナごと失われることがある
      w.__mq = mql;
    });

    const changes = () =>
      expect.poll(() =>
        page.evaluate(() => (window as unknown as { __mqCount?: number }).__mqCount),
      );

    // OS 側がテーマを変えても、ユーザーの選択が優先される。
    // 連続で emulateMedia を呼ぶと変更が合体して change が飛ばないので、
    // 1 段ずつ発火を確認してから次へ進める。
    await page.emulateMedia({ colorScheme: 'light' });
    await changes().toBe(1);
    await page.emulateMedia({ colorScheme: 'dark' });
    await changes().toBe(2);

    expect((await themeState(page)).attr).toBe('light');
  });

  test('まだ選んでいない間は OS 設定の変化に追従する', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    expect((await themeState(page)).attr).toBe('dark');

    await page.emulateMedia({ colorScheme: 'light' });

    await expect.poll(async () => (await themeState(page)).attr).toBe('light');
  });

  test('localStorage が使えなくても動く', async ({ page }) => {
    // プライベートモードやサイトデータ拒否設定を再現する
    await page.addInitScript(() => {
      const boom = () => { throw new Error('storage disabled'); };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
      });
    });

    await open(page);
    const before = (await themeState(page)).attr;

    await toggle(page).click();

    // 保存はできないが、その場の切り替えは効く
    expect((await themeState(page)).attr).not.toBe(before);
  });
});
