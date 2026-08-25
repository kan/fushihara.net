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

/** 64x64 の viewBox 上の標本点。角丸を避けた板の上と、f の縦棒の中 */
const PLATE = { x: 32, y: 4 };
const INK = { x: 21, y: 45 };

/** WCAG の相対輝度。tokens.css のコントラスト比と同じ尺度で見るため */
function luminance([r, g, b]: number[]) {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.beforeEach(async ({ page }) => {
  // ボードの中身には用が無い。上流を叩かせないよう API を落としておく
  // (CI を api.github.com やブログ Worker の生存に依存させないため)。
  await page.route('**/api/**', (r) => r.abort());
  await page.goto('/');
});

test('og:image が実体を指している', async ({ page, request }) => {
  // favicon と同じ shared/public 配線。画面に出ないので、消えても目視では気付けない。
  const href = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(href).toBe('https://fushihara.net/ogp.png');

  // クローラは絶対 URL しか解決しないが、テストは配信中のサーバーに聞く
  const res = await request.get(new URL(href!).pathname);
  expect(res.status()).toBe(200);
  expect((await res.body()).byteLength).toBeGreaterThan(0);
});

test('左上の見出しのマークが favicon と同じ形を使っている', async ({ page, request }) => {
  // 形（path の d）は favicon.svg と index.html の 2 箇所にある。`<use>` の外部参照は
  // Safari が読まないので inline にせざるを得ず、共有できない。片方だけ直して
  // 見た目がずれるのを防ぐため、ここで突き合わせる。
  const file = (await (await request.get('/favicon.svg')).text());
  const inFile = /<path[^>]*\sd="([^"]+)"/.exec(file)?.[1];

  const inPage = await page.locator('.site-brand-mark path').getAttribute('d');

  expect(inFile).toBeTruthy();
  expect(inPage).toBe(inFile);
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

/**
 * 本番で「オレンジの丸しか見えない」状態になったことがある。背景を透過にして
 * `f` の色を prefers-color-scheme で切り替えていたが、あれは OS の設定であって
 * **ブラウザのタブバーの明るさとは別物**なので、OS がダーク・ウィンドウがライトだと
 * 白い `f` が明るいタブバーに乗って消えた。
 *
 * ソースの書き方（メディアクエリ / `light-dark()` / 属性）に依存させないため、実際に
 * 描画して標本点の画素を見る。OS 設定をどちらに振っても、板が不透明で `f` が板と
 * 十分なコントラストを持つこと。
 */
test('OS 設定をどちらに振っても板が不透明で f が読める', async ({ page, request }) => {
  const svg = await (await request.get('/favicon.svg')).text();

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });

    const { plate, ink } = await page.evaluate(
      ([src, plateAt, inkAt]) =>
        new Promise<{ plate: number[]; ink: number[] }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, 64, 64);
            const at = (p: { x: number; y: number }) => [...ctx.getImageData(p.x, p.y, 1, 1).data];
            resolve({ plate: at(plateAt), ink: at(inkAt) });
          };
          img.onerror = () => reject(new Error('favicon.svg を画像として読めない'));
          // data: URL にするのは、ページの色スキームを直接反映させるため
          img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(src)))}`;
        }),
      [svg, PLATE, INK] as const,
    );

    expect(plate[3], `${colorScheme}: 板が不透明`).toBe(255);
    expect(ink[3], `${colorScheme}: f が不透明`).toBe(255);
    expect(contrast(plate, ink), `${colorScheme}: f と板のコントラスト`).toBeGreaterThan(4.5);
  }
});
