import { expect, test } from '@playwright/test';

/**
 * favicon の実体は shared/public にあり、vite.config.ts の publicDir 経由で配信物に
 * 入る。ブログと 1 つのファイルを共有するための配線なので、設定を触ると link タグを
 * 残したまま実体だけが消える。画面には出ず目視では気付けないため、link タグと実体を
 * 突き合わせる (ブログ側は blog/e2e/blog.spec.ts の「配信物」節が同じことを見る)。
 */
const ICONS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', href: '/favicon.ico' },
  { selector: 'link[rel="icon"][type="image/svg+xml"]', href: '/favicon.svg' },
  { selector: 'link[rel="apple-touch-icon"]', href: '/apple-touch-icon.png' },
];

/** `fill:` は favicon.svg の style ブロックの 2 宣言だけに一致する (丸は属性で書いてある) */
const INK = /fill:\s*(#[0-9A-Fa-f]{6})/g;

function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test.beforeEach(async ({ page }) => {
  // ボードの中身には用が無い。上流を叩かせないよう API を落としておく
  // (CI を zenn.dev / api.github.com の生存とレートリミットに依存させないため)。
  await page.route('**/api/**', (r) => r.abort());
  await page.goto('/');
});

test('link が 3 つとも実体を指している', async ({ page, request }) => {
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

  // favicon.svg は XML なので、コメントにハイフン 2 個を書くだけで壊れる (実際に踏んだ)。
  // 壊れたファイルも 200 で配信されてしまうので、パースが通ることまで見る。
  const root = await page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    return doc.querySelector('parsererror') ? 'parsererror' : doc.documentElement.tagName;
  }, bodies.get('/favicon.svg')!.toString());
  expect(root).toBe('svg');
});

// favicon の SVG は外部 CSS を解決できないので、f の色は tokens.css の値を焼き込む
// しかない。ずれても「タブのアイコンだけ本文と色が違う」でしか現れず、目視でも
// 気付けないので、実際に描画された本文の色 (var(--text)) と突き合わせる。
test('ink の色が本文の色と揃っている', async ({ page, request }) => {
  const svg = await (await request.get('/favicon.svg')).text();
  const ink = [...svg.matchAll(INK)].map((m) => m[1]);
  expect(ink, 'style ブロックに light / dark の 2 色').toHaveLength(2);

  for (const [theme, hex] of [
    ['light', ink[0]],
    ['dark', ink[1]],
  ] as const) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    // 色には transition が乗っているので、切り替え直後はまだ遷移前の値が返る。
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).color))
      .toBe(rgb(hex));
  }
});
