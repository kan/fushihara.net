import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { SERVICES } from '../services.ts';

/** 200 で、中身が空でないこと。配線が切れても画面には壊れた画像しか出ないので、実体まで見る */
async function expectServed(request: APIRequestContext, path: string, type: RegExp) {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  expect(res.headers()['content-type'], path).toMatch(type);
  expect((await res.body()).length, path).toBeGreaterThan(0);
}

test('services.ts の全サービスが、名前・説明・行き先付きで並ぶ', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('[data-service]');
  await expect(cards).toHaveCount(SERVICES.length);

  for (const s of SERVICES) {
    const card = page.locator(`[data-service="${s.id}"]`);
    const main = card.locator('.service-link');
    await expect(main).toHaveAttribute('href', s.url);
    await expect(main).toContainText(s.name);
    await expect(main).toContainText(s.description);
    for (const l of s.links ?? []) {
      await expect(card.getByRole('link', { name: l.label })).toHaveAttribute('href', l.url);
    }
  }
});

test('サービスのアイコンは自分のホストから読み、描画できている', async ({ page, request }) => {
  await page.goto('/');
  for (const s of SERVICES) {
    const img = page.locator(`[data-service="${s.id}"] .service-icon`);
    // ほかのサービスのホストを直接指すと、Access のログイン画面へのリダイレクトになる
    await expect(img).toHaveAttribute('src', `/icons/${s.id}.svg`);
    await expectServed(request, `/icons/${s.id}.svg`, /^image\/svg\+xml/);
    // naturalWidth が 0 なら、配信されていてもパースできていない
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), s.id).toBeGreaterThan(0);
  }
});

/** 左上の角の画素のアルファ値 */
async function cornerAlpha(page: Page, src: string): Promise<number | undefined> {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, src);
}

// 画面幅に依らない検査。mobile で回しても同じことを 2 回見るだけなので、desktop でだけ回す
test.describe('配信物', () => {
  test.skip(({ isMobile }) => isMobile, '画面幅に依らない');

  test('ホーム画面へ追加するための manifest とアイコンがそろっている', async ({ page, request }) => {
    await page.goto('/');

    const link = page.locator('link[rel="manifest"]');
    const manifestHref = await link.getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');
    // Cookie を付けて取らせる。付けないと Access の内側でログイン画面へのリダイレクトになる
    // （ローカルに Access は無いので、属性で見るしかない）
    await expect(link).toHaveAttribute('crossorigin', 'use-credentials');
    const res = await request.get(manifestHref!);
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' });

    // Android（Chrome）がインストールに要求する 192 と 512 の PNG
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) {
      await expectServed(request, icon.src, /^image\/png/);
    }

    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(touch).toBe('/apple-touch-icon.png');
    await expectServed(request, touch!, /^image\/png/);
  });

  test('apple-touch-icon と maskable は角まで不透明、それ以外は角が丸い', async ({ page }) => {
    await page.goto('/');
    // 角を丸めて透明にすると、iOS がそこを黒く塗る（端末が自分でマスクする）
    for (const path of ['/apple-touch-icon.png', '/icon-maskable-512.png']) {
      expect(await cornerAlpha(page, path), path).toBe(255);
    }
    // 端末がマスクしない purpose: any のほうは、ビルドが角を丸めている
    for (const path of ['/icon-192.png', '/icon-512.png']) {
      expect(await cornerAlpha(page, path), path).toBe(0);
    }
  });

  test('検索エンジンに載せず、スクリプトを読まないヘッダが付く', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
  });

  test('スマートフォンの幅で横にはみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
