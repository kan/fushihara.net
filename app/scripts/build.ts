/**
 * ランチャーの配信物を `dist/` に組み立てる。
 *
 * **Worker のスクリプトは無い。** 配るのは静的アセットだけで、守るのは Cloudflare
 * Access（`wrangler.jsonc` のコメント参照）。中身はリクエストに依らないので、
 * HTML もここで 1 回だけ作る。
 *
 * Node の型の除去で直接動かす（`node scripts/build.ts`）。そのため import には
 * 拡張子を付け、`enum` のような消せない構文は書かない（tsconfig の
 * `erasableSyntaxOnly` が見張る）。
 */
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SERVICES, iconPath, type Service } from '../services.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

const APP_NAME = 'fushihara.net apps';
/** ホーム画面のアイコンの下に出る名前。長いと端末が省略する */
const SHORT_NAME = 'apps';
/** manifest の背景とテーマの色。アイコンの板（`public/icon.svg`）と同じ紺 */
const BRAND_BG = '#1A1A2E';

validate(SERVICES);

// 前回の成果物を捨ててから作る。上書きだけだと、一覧から外したサービスの
// アイコンが残って配られ続ける。
await rm(dist, { recursive: true, force: true });
// public/ はそのまま配る（_headers と icon.svg）。生成物はこのあとに書く。
await cp(join(root, 'public'), dist, { recursive: true });
await mkdir(join(dist, 'icons'), { recursive: true });

for (const s of SERVICES) {
  await copyFile(join(root, iconPath(s)), join(dist, 'icons', `${s.id}.svg`));
}

await writeIcons();

// 色は shared/tokens.css が正。本体とブログと同じパレットを使う。
// @import にせず連結するのは、CSS を 1 本で配って往復を減らすため。
const css = [
  await readFile(join(root, '..', 'shared', 'tokens.css'), 'utf8'),
  await readFile(join(root, 'src', 'style.css'), 'utf8'),
].join('\n');
await writeFile(join(dist, 'style.css'), css);

await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest(), null, 2));
await writeFile(join(dist, 'index.html'), page(SERVICES));

console.log(`ランチャーを ${dist} に置いた（${SERVICES.length} 件）`);

/**
 * PNG のアイコンを SVG から起こす。**正本は `public/icon.svg`（角の無い正方形）。**
 * PNG を手で持つと、図柄を直したときにホーム画面のアイコンだけ古いまま残る。
 *
 * **apple-touch-icon と maskable は角を丸めない。** iOS と Android が自分で
 * マスクをかけるので、丸めると二重に丸まり、角の透明部分を黒く塗られる
 * （本体の apple-touch-icon.png と同じ理由。CLAUDE.md「favicon」）。
 * それ以外（manifest の purpose: any）は、ここで角を丸める。
 */
async function writeIcons() {
  const svg = await readFile(join(root, 'public', 'icon.svg'));
  const targets = [
    { out: 'apple-touch-icon.png', size: 180, round: false },
    { out: 'icon-192.png', size: 192, round: true },
    { out: 'icon-512.png', size: 512, round: true },
    { out: 'icon-maskable-512.png', size: 512, round: false },
  ];
  for (const t of targets) {
    // density は最大の 512px でもぼやけない値に固定し、大きさは resize に任せる
    let img = sharp(svg, { density: 600 }).resize(t.size, t.size);
    if (t.round) {
      // 角の半径は、本体の favicon.svg と同じ 64 分の 10
      const r = (t.size * 10) / 64;
      const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${t.size}" height="${t.size}"><rect width="100%" height="100%" rx="${r}"/></svg>`;
      img = img.composite([{ input: Buffer.from(mask), blend: 'dest-in' }]);
    }
    await img.png().toFile(join(dist, t.out));
  }
}

function manifest() {
  return {
    name: APP_NAME,
    short_name: SHORT_NAME,
    lang: 'ja',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_BG,
    theme_color: BRAND_BG,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

// 検索エンジン向けの noindex は public/_headers の X-Robots-Tag が付ける。
//
// **manifest の crossorigin="use-credentials" を外さないこと。** 付けないと、同じ
// origin でもブラウザは Cookie を付けずに manifest を取りに行く。Access の内側では
// ログイン画面へのリダイレクトになり、ホーム画面のアイコンも standalone も効かない。
//
// theme-color は画面の背景（tokens.css の --bg）に合わせて OS のテーマで分ける。
function page(services: Service[]): string {
  const cards = services.map(card).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0A0A0F" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F5F5F7" media="(prefers-color-scheme: light)">
<meta name="apple-mobile-web-app-title" content="${SHORT_NAME}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${APP_NAME}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="brand">
<img src="/icon.svg" alt="" width="28" height="28">
<h1>${APP_NAME}</h1>
</header>
<main>
<ul class="services">
${cards}
</ul>
</main>
</body>
</html>
`;
}

function card(s: Service): string {
  const links = (s.links ?? [])
    .map((l) => `<a class="sub-link" href="${esc(l.url)}">${esc(l.label)}</a>`)
    .join('');
  return `<li class="service" data-service="${esc(s.id)}">
<a class="service-link" href="${esc(s.url)}">
<img class="service-icon" src="/icons/${esc(s.id)}.svg" alt="" width="48" height="48">
<span class="service-name">${esc(s.name)}</span>
<span class="service-desc">${esc(s.description)}</span>
<span class="service-host">${esc(new URL(s.url).host)}</span>
</a>${links ? `\n<div class="sub-links">${links}</div>` : ''}
</li>`;
}

/**
 * 一覧の誤りをビルドで止める。画面に出てから気付くと、Access の内側なので
 * 確かめるのに毎回ログインが要る。アイコンが無いときは、直後の copyFile が止める。
 */
function validate(services: Service[]) {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of services) {
    if (!/^[a-z0-9-]+$/.test(s.id)) errors.push(`${s.id}: id は英小文字・数字・ハイフンだけ`);
    if (ids.has(s.id)) errors.push(`${s.id}: id が重複している`);
    ids.add(s.id);
    for (const u of [s.url, ...(s.links ?? []).map((l) => l.url)]) {
      if (!URL.canParse(u) || new URL(u).protocol !== 'https:') {
        errors.push(`${s.id}: https の絶対 URL ではない (${u})`);
      }
    }
    if (extname(iconPath(s)) !== '.svg') errors.push(`${s.id}: アイコンは SVG だけ (${iconPath(s)})`);
  }
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
}

/** テキストにも属性値にも使う。テキストの中の `"` を `&quot;` にしても表示は変わらない */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
