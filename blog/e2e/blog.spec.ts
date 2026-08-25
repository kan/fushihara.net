import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { STORAGE_KEY } from '../../shared/theme';
import { SITE_NAME, SITE_URL, pageTitle } from '../src/lib/site';

/**
 * このファイルは「Astro のテスト」ではなく「ブログの契約のテスト」。
 *
 * 対象は content/ の実記事ではなく test-content/ のフィクスチャ。実記事に依存させると
 * 記事を書き換えるたびにテストが落ちるため (playwright.config.ts の BLOG_CONTENT_DIR)。
 * CONTRACT.md に書いた URL / RSS / 404 / テーマの取り決めだけを検査していて、
 * Astro 固有の API には一切触れていない。将来生成器を自作 OSS に置き換えるとき、
 * そのまま合否判定に使えることを狙っている。
 */

const POST = '/blog/rendering-sample/';
const POST_TITLE = '描画サンプル';

const ICONS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', href: '/blog/favicon.ico' },
  { selector: 'link[rel="icon"][type="image/svg+xml"]', href: '/blog/favicon.svg' },
  { selector: 'link[rel="apple-touch-icon"]', href: '/blog/apple-touch-icon.png' },
];

/**
 * RSS から 1 記事分の本文 (`content:encoded`) を取り出し、検査したいものだけ返す。
 *
 * XML も HTML も本物のパーサに通す。手で `<item>` を切って実体参照を戻すと、
 * CDATA や数値実体を吐く生成器に替わった日に**黙って通る側へ倒れる**。
 */
async function feedHtml(page: Page, request: APIRequestContext, title: string) {
  const xml = await (await request.get('/blog/rss.xml')).text();

  const feed = await page.evaluate(
    ([source, wanted]) => {
      const item = [...new DOMParser().parseFromString(source, 'text/xml').querySelectorAll('item')]
        .find((el) => el.querySelector('title')?.textContent === wanted);
      const content = item?.getElementsByTagName('content:encoded')[0]?.textContent;
      if (content == null) return null;

      const doc = new DOMParser().parseFromString(content, 'text/html');
      const attrs = ['src', 'href', 'srcset'];
      return {
        text: doc.body.textContent ?? '',
        // 属性は要素から取る。生の文字列を走査すると、コードブロックに書いた
        // HTML (text ノード) まで拾ってしまう。
        urls: [...doc.querySelectorAll('[src],[href],[srcset]')]
          .flatMap((el) => attrs.map((a) => el.getAttribute(a)))
          .filter((v): v is string => !!v),
        styles: [...doc.querySelectorAll('[style]')].map((el) => el.getAttribute('style') ?? ''),
        code: [...doc.querySelectorAll('code')].map((el) => el.textContent ?? ''),
      };
    },
    [xml, title] as const,
  );

  expect(feed, `RSS に「${title}」の本文が無い`).not.toBeNull();
  return feed!;
}

async function themeState(page: Page) {
  return page.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
}

test.describe('URL 設計', () => {
  test('一覧が記事へリンクする', async ({ page }) => {
    await page.goto('/blog/');
    const link = page.getByRole('link', { name: POST_TITLE });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', POST);
  });

  test('記事は /blog/<slug>/ で開ける', async ({ page }) => {
    const res = await page.goto(POST);
    expect(res?.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE_URL}${POST}`,
    );
    await expect(page.getByRole('heading', { level: 1, name: POST_TITLE })).toBeVisible();
  });

  test('末尾スラッシュ無しは付きへ寄せられる', async ({ page }) => {
    await page.goto('/blog/rendering-sample');
    expect(new URL(page.url()).pathname).toBe(POST);
  });

  test('存在しないパスは 404 ページを返す', async ({ page }) => {
    const res = await page.goto('/blog/no-such-post/');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  });

  test('404 ページはインデックスさせない', async ({ page }) => {
    // /blog/404 は素直に辿ると 200 を返せてしまう。canonical で指すと実在ページとして
    // 拾われるので、canonical を出さず noindex を立てる。
    await page.goto('/blog/no-such-post/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });
});

test.describe('ナビゲーション', () => {
  // パンくずが「どこにいるか」と「戻り道」の両方を担っている。ここが壊れると
  // 記事から検索で来た人がポートフォリオにも一覧にも辿り着けない。
  test('記事からポートフォリオと一覧に戻れる', async ({ page }) => {
    await page.goto(POST);
    await expect(page.getByRole('link', { name: 'fushihara.net' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'blog', exact: true })).toHaveAttribute('href', '/blog/');
  });

  test('見出しは一覧ではパンくず、記事では記事名', async ({ page }) => {
    await page.goto('/blog/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('blog');

    await page.goto(POST);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(POST_TITLE);
  });
});

test.describe('並び順と日付', () => {
  test('新しい順。date が同じときは slug の昇順', async ({ page }) => {
    await page.goto('/blog/');
    const paths = await page
      .locator('.post-list h2 a')
      .evaluateAll((els) => els.map((el) => new URL((el as HTMLAnchorElement).href).pathname));

    expect(paths).toEqual([
      '/blog/rendering-sample/', // 8/23
      '/blog/order-time-z/', // 8/20 21:00 — slug は a より後ろだが時刻で勝つ
      '/blog/order-time-a/', // 8/20 08:00
      '/blog/order-tie-a/', // 8/19 — date が同じなので slug 昇順
      '/blog/order-tie-b/', // 8/19
    ]);
  });

  test('早朝 JST の記事が前日にならない', async ({ page }) => {
    await page.goto('/blog/order-time-a/');
    // frontmatter は 2026-08-20T08:00:00+09:00。UTC で切り出すと 8/19 になってしまう
    const time = page.locator('article time').first();
    await expect(time).toHaveAttribute('datetime', '2026-08-20');
    await expect(time).toHaveText('2026/08/20');
  });
});

test.describe('記事の描画', () => {
  test('見出し・コード・画像・引用が出る', async ({ page }) => {
    await page.goto(POST);
    await expect(page.getByRole('heading', { level: 2, name: '見出し 2' })).toBeVisible();

    // コードブロックがハイライトされている。span があるだけでは Shiki の色付けが
    // 効いているか分からない (色が当たらなくても span は出る) ので、地の文と違う色に
    // なっていることまで見る。
    const keyword = page.locator('pre code span', { hasText: 'export' }).first();
    await expect(keyword).toBeVisible();
    const [codeColor, bodyColor] = await Promise.all([
      keyword.evaluate((el) => getComputedStyle(el).color),
      page.locator('body').evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(codeColor).not.toBe(bodyColor);

    const img = page.getByAltText('サンプル画像');
    await expect(img).toBeVisible();
    // 壊れた img は naturalWidth が 0 になる
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    await expect(page.locator('blockquote')).toContainText('引用も使える');
  });
});

test.describe('コードハイライト', () => {
  // Shiki は色を書かず --shiki-light / --shiki-dark だけを出し、light-dark() が
  // どちらを使うか決める。テーマで色が変わらなければその配線が切れている。
  test('どちらのテーマでも地の文と違う色になる', async ({ page }) => {
    const colors = () =>
      page.evaluate(() => ({
        keyword: getComputedStyle(
          [...document.querySelectorAll('pre code span')].find((el) => el.textContent === 'export')!,
        ).color,
        body: getComputedStyle(document.body).color,
      }));

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(POST);

    // 片側だけ配線が切れると、そのテーマでだけ地の文の色を継いでしまう。
    // 「テーマ間で色が変わること」を見るだけでは、地の文の色も変わるので気付けない。
    const dark = await colors();
    expect(dark.keyword).not.toBe(dark.body);

    await page.locator('.theme-toggle').click();
    await expect.poll(async () => (await colors()).body, { timeout: 5_000 }).not.toBe(dark.body);

    const light = await colors();
    expect(light.keyword).not.toBe(light.body);
    expect(light.keyword).not.toBe(dark.keyword);
  });
});

test.describe('配信物', () => {
  // 画面には出ないので目視では気付けない。名前の置き場所が 1 箇所に保たれて
  // いるかを見る (値そのものは好みなので、ずれていないことだけを検査する)。
  test('title と RSS の名前が揃っている', async ({ page, request }) => {
    await page.goto('/blog/');
    await expect(page).toHaveTitle(SITE_NAME);

    await page.goto(POST);
    await expect(page).toHaveTitle(pageTitle(POST_TITLE));

    const xml = await (await request.get('/blog/rss.xml')).text();
    expect(xml).toContain(`<title>${SITE_NAME}</title>`);
  });

  test('og:image が実体を指している', async ({ page, request }) => {
    // 実体は本体サイトと共有の shared/public。画面に出ないので消えても気付けない。
    await page.goto('/blog/');
    const href = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(href).toBe(`${SITE_URL}/blog/ogp.png`);

    const res = await request.get(new URL(href!).pathname);
    expect(res.status()).toBe(200);
    expect((await res.body()).byteLength).toBeGreaterThan(0);
  });

  test('RSS が絶対 URL の記事リンクを持つ', async ({ request }) => {
    const res = await request.get('/blog/rss.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`<link>${SITE_URL}${POST}</link>`);
    expect(xml).toContain(`<title>${POST_TITLE}</title>`);
  });

  // CONTRACT.md の「RSS は全文を配る」。要約だけ配ると購読者がリーダーの中で
  // 記事を読めない。ページと同じ HTML を載せるので、ページ側では正しくても
  // リーダーの中では壊れる点を重点的に見る。
  test('RSS が本文を全文で配る', async ({ page, request }) => {
    const feed = await feedHtml(page, request, POST_TITLE);

    // description は要約のまま。本文は冒頭から末尾まで content:encoded 側に入る。
    expect(feed.text).toContain('見出し 2');
    expect(feed.text).toContain('displayDate');
    expect(feed.text).toContain('引用も使える');
  });

  test('RSS の本文に相対 URL が残らない', async ({ page, request }) => {
    // リーダーは記事の URL を起点に解決してくれないので、画像・記事内リンク・
    // 脚注のアンカーが相対のままだと全部壊れる。
    const feed = await feedHtml(page, request, POST_TITLE);

    expect(feed.urls.length, 'フィクスチャに画像とリンクがある').toBeGreaterThan(0);
    expect(feed.urls.filter((u) => !URL.canParse(u))).toEqual([]);

    // 画像が実際に取得できるところまで見る。ファイル名は生成器の都合なので固定しない。
    const image = feed.urls.find((u) => /\.(webp|png|jpe?g|svg|gif)$/i.test(u));
    expect(image, '本文の画像が絶対 URL で入っている').toBeDefined();

    // 絶対 URL は本番のホストを指すので、パスだけ取り出してテストサーバーに投げる
    // (そのまま request.get すると本番を叩いてしまう)。
    const url = new URL(image!);
    expect(url.origin, '絶対化の起点が配信するサイト').toBe(SITE_URL);
    expect((await request.get(url.pathname)).status()).toBe(200);
  });

  test('RSS の本文が CSS 変数に頼らない', async ({ page, request }) => {
    // リーダーはこのブログのスタイルシートを読まないので、カスタムプロパティに
    // 入れた色はどこにも解決されない。色は要素に直接書けていること。
    const feed = await feedHtml(page, request, POST_TITLE);

    expect(feed.styles.filter((s) => /(^|;)\s*--/.test(s) || s.includes('var('))).toEqual([]);
    expect(feed.styles.some((s) => /(^|;)\s*color:/.test(s)), 'コードに色が付く').toBe(true);
  });

  // 後処理が書き換えてよいのはタグの中の属性だけ。本文に書いた HTML まで書き換えると
  // 記事とリーダーで中身が食い違う (理由は blog/src/lib/feed-html.ts の doc comment)。
  test('RSS が本文中の HTML を書き換えない', async ({ page, request }) => {
    const feed = await feedHtml(page, request, POST_TITLE);

    // インラインコードと、言語指定なしのコードブロック
    expect(feed.code).toContain('<img src="./dog.png">');
    expect(feed.code).toContain('<img src="./cat.png">');
  });

  test('sitemap がある', async ({ request }) => {
    const res = await request.get('/blog/sitemap-index.xml');
    expect(res.status()).toBe(200);
  });

  // favicon の実体はリポジトリ直下の shared/public にあり、astro.config.mjs の
  // publicDir 経由で dist/blog に入る。本体サイトと 1 つのファイルを共有するための
  // 配線なので、設定を触ると link タグを残したまま実体だけが消える。
  test('favicon の link が 3 つとも実体を指している', async ({ page, request }) => {
    await page.goto('/blog/');

    const bodies = new Map<string, Buffer>();
    await Promise.all(
      ICONS.map(async ({ href }) => {
        const res = await request.get(href);
        expect(res.status(), href).toBe(200);
        bodies.set(href, await res.body());
      }),
    );

    for (const { selector, href } of ICONS) {
      await expect(page.locator(selector)).toHaveAttribute('href', href);
      expect(bodies.get(href)?.byteLength, href).toBeGreaterThan(0);
    }

    // favicon.svg は XML なので、コメントにハイフン 2 個を書くだけで壊れる (実際に
    // 踏んだ)。壊れたファイルも 200 で配信されるので、パースが通ることまで見る。
    // 実体は本体サイトと同じファイルだが、生成器を差し替えた日にここだけで合否を
    // 出せるよう、この節でも独立に見る。
    const root = await page.evaluate((src) => {
      const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
      return doc.querySelector('parsererror') ? 'parsererror' : doc.documentElement.tagName;
    }, bodies.get('/blog/favicon.svg')!.toString());
    expect(root).toBe('svg');
  });

  test('一覧が RSS を autodiscovery で指す', async ({ page }) => {
    await page.goto('/blog/');
    await expect(page.locator('link[type="application/rss+xml"]')).toHaveAttribute(
      'href',
      '/blog/rss.xml',
    );
  });
});

test.describe('下書き', () => {
  // draft: true が本番ビルドから落ちることを守る。ここが唯一の担保なので、
  // test-content/posts/draft-example/ を消すとこの検査も無効になる。
  test('一覧に出ない', async ({ page }) => {
    await page.goto('/blog/');
    await expect(page.getByRole('link', { name: '下書きの例' })).toHaveCount(0);
  });

  test('ページが生成されない', async ({ page }) => {
    const res = await page.goto('/blog/draft-example/');
    expect(res?.status()).toBe(404);
  });

  test('RSS に載らない', async ({ request }) => {
    const xml = await (await request.get('/blog/rss.xml')).text();
    expect(xml).not.toContain('下書きの例');
  });
});

test.describe('テーマ', () => {
  test('既定はダーク', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/blog/');
    expect((await themeState(page)).attr).toBe('dark');
  });

  test('切り替えると背景色まで変わる', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/blog/');
    const before = await themeState(page);

    await page.locator('.theme-toggle').click();

    expect((await themeState(page)).attr).toBe('light');
    // 背景色には 0.25s の transition が乗っている。クリック直後に読むと
    // まだ遷移前の値が返るので、確定するまで待つ。
    await expect
      .poll(async () => (await themeState(page)).bg, { timeout: 5_000 })
      .not.toBe(before.bg);
  });

  test('ラベルが押した先を伝える', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/blog/');
    const button = page.locator('.theme-toggle');

    // 静的 HTML の中立な文言は、読み込み後に方向つきへ差し替わる
    await expect(button).toHaveAttribute('aria-label', 'ライトテーマに切り替え');
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'ダークテーマに切り替え');
  });

  test('選択は本体サイトと同じキーに保存される', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/blog/');
    await page.locator('.theme-toggle').click();

    // キーがずれると / と /blog/ を行き来したときにテーマが引き継がれない
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe('light');
  });

  test('保存した選択は再読み込みでも残り、JS を待たずに反映される', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript((k) => localStorage.setItem(k, 'light'), STORAGE_KEY);

    // head のインラインスクリプトの仕事なので、モジュールが動く前に確定していること
    await page.goto('/blog/', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.body !== null);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  });
});
