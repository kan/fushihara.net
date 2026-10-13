import { expect, test, type Page } from '@playwright/test';
import { boardData, EXTRA_SKILLS, OSS_REPOS } from '../src/board-data';
import { MARGIN, MOBILE_GAP, MOBILE_TOP, mobileOrder } from '../src/layout';

// 外部 API はモックする。CI を api.github.com の生存とレートリミット、ブログ Worker の
// 応答に依存させないため。Worker 側のプロキシ挙動は test/worker.test.ts が担当する。
const BLOG = {
  posts: [
    {
      title: 'モック記事タイトル',
      link: 'https://fushihara.net/blog/mock/',
      date: '2026-08-24T15:00:00.000Z',
    },
  ],
};
// OSS 付箋に出す顔ぶれは board-data.ts が決め、説明だけ API から来る。
// 1 本目にだけ値を持たせて「補完されること」と「API に無くても消えないこと」を見る。
const REPOS = [
  {
    name: OSS_REPOS[0],
    description: 'モックの説明',
    html_url: `https://github.com/kan/${OSS_REPOS[0]}`,
    language: 'TypeScript',
    fork: false,
  },
];
// 2 本目は手書きの追加分と重複させ、二重に出ないことを見る
const LANGUAGES = {
  languages: [{ name: 'MockLang', count: 9 }, { name: EXTRA_SKILLS[0], count: 1 }],
};

const NOTE = '.wema-note';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/blog*', (r) => r.fulfill({ json: BLOG }));
  await page.route('**/api/github?*', (r) => r.fulfill({ json: REPOS }));
  await page.route('**/api/github-languages*', (r) => r.fulfill({ json: LANGUAGES }));
});

/** ノート id → 画面上の矩形 */
async function noteBoxes(page: Page) {
  return page.$$eval(NOTE, (els) =>
    Object.fromEntries(
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return [
          el.getAttribute('data-note-id') ?? '',
          { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        ];
      }),
    ),
  );
}

/**
 * 付箋の本文。見出しの文字（hasText）で付箋を探さないこと。モバイルでは中央の付箋の
 * 下に、つながっている付箋の見出しがボタンで並ぶので（noteLinks）、2 枚に一致する
 */
function noteContent(page: Page, id: string) {
  return page.locator(`${NOTE}[data-note-id="${id}"] .wema-note-content`);
}

/** 動的データの反映まで待つ */
async function gotoAndSettle(page: Page) {
  await page.goto('/');
  await expect(page.locator(NOTE).first()).toBeVisible();
  await expect(page.getByText('モック記事タイトル')).toBeVisible();
}

test('ボードが描画され、全ノートが表示される', async ({ page }) => {
  await gotoAndSettle(page);

  const boxes = await noteBoxes(page);
  expect(Object.keys(boxes).sort()).toEqual([
    'blog', 'center', 'email', 'interests', 'links',
    'oss', 'poweredby', 'skills', 'social',
  ]);
});

test('取得したデータが対応するノートに反映される', async ({ page }) => {
  await gotoAndSettle(page);

  const blogNote = noteContent(page, 'blog');
  await expect(blogNote).toContainText('モック記事タイトル');
  // pubDate は JST で出す (UTC 15:00 は翌日)
  await expect(blogNote).toContainText('2026-08-25');
  const ossNote = noteContent(page, 'oss');
  for (const name of OSS_REPOS) await expect(ossNote).toContainText(name);
  await expect(ossNote).toContainText('モックの説明');
  const skillsNote = noteContent(page, 'skills');
  await expect(skillsNote).toContainText('MockLang');
  // 集計した言語のあとに手書きの道具が続く。重複は落とす
  for (const skill of EXTRA_SKILLS) await expect(skillsNote).toContainText(skill);
  expect((await skillsNote.innerText()).split(EXTRA_SKILLS[0]).length - 1).toBe(1);
});

test('左上にサイトの見出しが出る', async ({ page }) => {
  await gotoAndSettle(page);

  const brand = page.getByRole('heading', { name: 'fushihara.net' });
  await expect(brand).toBeVisible();

  // 見出しは position: fixed なので、ノートと重なると読めなくなる
  const b = (await brand.boundingBox())!;
  const overlapping = await page.$$eval(
    NOTE,
    (els, b) =>
      els
        .map((el) => ({ id: el.getAttribute('data-note-id'), r: el.getBoundingClientRect() }))
        .filter(
          ({ r }) =>
            r.width > 0 &&
            r.left < b.x + b.width &&
            r.right > b.x &&
            r.top < b.y + b.height &&
            r.bottom > b.y,
        )
        .map(({ id }) => id),
    b,
  );

  expect(overlapping).toEqual([]);
});

test('連絡先はデスクトップでも畳まれていない', async ({ page }) => {
  await gotoAndSettle(page);

  // 以前は email を折り畳みのデモに使っていて、hover するまでアドレスが出なかった。
  // 連絡手段はこのサイトの主目的の 1 つなので、初期表示で読めること。
  const link = page.getByRole('link', { name: 'kan.fushihara@gmail.com' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'mailto:kan.fushihara@gmail.com');
});

test('付箋の中身がはみ出さない（縦スクロールが出ない）', async ({ page }) => {
  await gotoAndSettle(page);

  // 見出しの後の <br> を 1 つ余らせただけで中身がはみ出し、付箋の中に
  // 縦スクロールが出る（実際に踏んだ）。目では気付きにくいので測る。
  const overflowing = await page.$$eval('.wema-note', (els) =>
    els
      .map((el) => {
        const content = el.querySelector('.wema-note-content')!;
        return {
          id: el.getAttribute('data-note-id'),
          over: content.scrollHeight - content.clientHeight,
        };
      })
      .filter((r) => r.over > 1),
  );

  expect(overflowing).toEqual([]);
});

// アイコンは手書きの SVG を data URI にしたもの（wema / lily）。**XML なので
// 閉じ忘れや `--` 1 つで丸ごと壊れる**が、壊れても「絵が出ない」だけで
// エラーは出ない（favicon で実際に踏んだ）。実際に描かせて確かめる。
test('Powered by のアイコンが全部デコードできる', async ({ page }) => {
  await gotoAndSettle(page);

  // **1 往復で全部見る。** `gotoAndSettle` の後は描き終わっているので、
  // アイコンごとに待ちながら往復する必要がない。
  const icons = await page.locator('[data-note-id="poweredby"]').evaluate((note) =>
    [...note.querySelectorAll('img')].map((img) => ({
      src: (img.getAttribute('src') ?? '').slice(0, 60),
      width: img.naturalWidth,
    })),
  );

  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) expect(icon.width, icon.src).toBeGreaterThan(0);
});

test('リンクが新しいタブで開く形になっている', async ({ page }) => {
  await gotoAndSettle(page);

  const link = page.getByRole('link', { name: 'モック記事タイトル' });
  await expect(link).toHaveAttribute('href', 'https://fushihara.net/blog/mock/');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('rel=me が Social 付箋のアカウントと一致する', async ({ page }) => {
  // 「このアカウントは自分だ」の宣言。**相互リンクで初めて意味を持つ**ので、
  // 付箋のリンクと 1 文字でも違うと黙って効かなくなる。どちらも
  // `src/board-data.ts` の `SOCIAL_LINKS` から出ているが、片方を手書きに
  // 戻した日にここで気付けるよう、実際に配信された HTML で突き合わせる。
  await gotoAndSettle(page);

  const declared = await page.locator('head link[rel="me"]').evaluateAll((links) =>
    links.map((link) => (link as HTMLLinkElement).getAttribute('href')),
  );
  const shown = await page
    .locator('[data-note-id="social"] a')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute('href')));

  expect(shown.length).toBeGreaterThan(0);
  expect(declared).toEqual(shown);
});

test('API が全滅しても静的な内容は残る', async ({ page }) => {
  await page.route('**/api/**', (r) => r.fulfill({ status: 500, body: 'boom' }));

  await page.goto('/');
  await expect(page.locator(NOTE).first()).toBeVisible();

  // board-data.ts の静的テキストがそのまま出ている
  const ossNote = noteContent(page, 'oss');
  for (const name of OSS_REPOS) await expect(ossNote).toContainText(name);

  const blogNote = noteContent(page, 'blog');
  await expect(blogNote).toContainText('Loading...');
  // API を 1 つも要らない唯一の行き先なので、全滅時こそ導線を残す
  await expect(blogNote.getByRole('link', { name: 'more...' })).toHaveAttribute('href', '/blog/');
  expect(Object.keys(await noteBoxes(page))).toHaveLength(9);
});

test.describe('デスクトップ', () => {
  test.skip(({ isMobile }) => !!isMobile, 'デスクトップ専用');

  test('poweredby が右下に固定される', async ({ page }) => {
    await gotoAndSettle(page);

    const { boxes, vw, vh } = await page.evaluate(() => ({
      vw: window.innerWidth,
      vh: window.innerHeight,
      boxes: [...document.querySelectorAll('.wema-note')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-note-id'), right: r.right, bottom: r.bottom };
      }),
    }));

    const pb = boxes.find((b) => b.id === 'poweredby')!;
    expect(Math.round(vw - pb.right)).toBe(MARGIN);
    expect(Math.round(vh - pb.bottom)).toBe(MARGIN);
  });

  test('ノートが 1 カラムに潰れていない', async ({ page }) => {
    await gotoAndSettle(page);

    const xs = new Set(Object.values(await noteBoxes(page)).map((b) => b.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  test('折り畳みバッジから Interests を開ける', async ({ page }) => {
    await gotoAndSettle(page);

    // wema の折り畳みボタンは辺ごとで、その辺のエッジが全部畳まれているときだけ
    // 件数バッジになる。他のエッジと同居させるとバッジが出ず、押すと巻き添えで
    // 畳まれる。board-data.ts が下辺を Interests 専用にしていることの検査。
    const badge = page.locator('.wema-note-collapse-badge');
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText('1');

    await badge.click();

    await expect
      .poll(async () => (await noteBoxes(page)).interests.w, { timeout: 5_000 })
      .toBeGreaterThan(0);
  });

  test('幅を狭めると 1 カラムに再配置され、畳まれたエッジも開く', async ({ page }) => {
    await gotoAndSettle(page);

    // デスクトップでは interests は collapsed のまま幅 0
    expect((await noteBoxes(page)).interests.w).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });

    // resize はアニメーション (300ms) 経由なので落ち着くまで待つ。
    // ここで幅 0 を除外してしまうと、collapsed が解除されない不具合を
    // 見逃すので全ノートを対象に判定する。
    await expect
      .poll(async () => Object.values(await noteBoxes(page)), { timeout: 5_000 })
      .toEqual(
        Array(mobileOrder.length).fill(
          expect.objectContaining({ x: MARGIN, w: 390 - MARGIN * 2 }),
        ),
      );
  });

  test('狭めてから戻すと、元の配置と折り畳みに戻る', async ({ page }) => {
    await gotoAndSettle(page);
    const before = await noteBoxes(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await noteBoxes(page)).interests.w, { timeout: 5_000 })
      .toBe(390 - MARGIN * 2);

    // 戻りは「ページのスクロールをやめる → エッジを畳む → 列を抜けて元の座標へ」。
    // 後ろの 2 つが欠けると、デスクトップの配置に戻らない。
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => noteBoxes(page), { timeout: 5_000 }).toEqual(before);

    // 1 つ目が欠けても配置は戻るので、別に見る。pageScroll が残っていると、
    // ホイールでボードがパンしない。
    await page.mouse.move(700, 800);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(async () => (await noteBoxes(page)).center.y)
      .toBeLessThan(before.center.y);
  });
});

test.describe('モバイル', () => {
  test.skip(({ isMobile }) => !isMobile, 'モバイル専用');

  test('全ノートが左マージン揃いの 1 カラムになる', async ({ page }) => {
    await gotoAndSettle(page);

    const vw = await page.evaluate(() => window.innerWidth);
    for (const [id, box] of Object.entries(await noteBoxes(page))) {
      expect(box.x, id).toBe(MARGIN);
      expect(box.w, id).toBe(vw - MARGIN * 2);
    }
  });

  test('mobileOrder の順に上から積まれる', async ({ page }) => {
    await gotoAndSettle(page);

    const boxes = await noteBoxes(page);
    const ys = mobileOrder.map((id) => boxes[id].y);

    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  test('MOBILE_TOP から始まり、MOBILE_GAP ずつ空けて積まれる', async ({ page }) => {
    await gotoAndSettle(page);

    // 積むのは wema（setStacked()）で、渡した開始位置と間隔が効いていることを見る。
    // 間隔は、付箋の下に並ぶボタン（noteLinks）の下から数える。ボタンは付箋の枠の
    // 外に出るので、付箋の矩形には入らない
    const boxes = await noteBoxes(page);
    const footers = await page.$$eval(NOTE, (els) =>
      Object.fromEntries(els.map((el) => [
        el.getAttribute('data-note-id') ?? '',
        Math.round(el.querySelector(':scope > .wema-note-footer')?.getBoundingClientRect().height ?? 0),
      ])),
    );
    expect(boxes[mobileOrder[0]].y).toBe(MOBILE_TOP);
    for (let i = 1; i < mobileOrder.length; i++) {
      const prevId = mobileOrder[i - 1];
      const prev = boxes[prevId];
      expect(boxes[mobileOrder[i]].y, mobileOrder[i])
        .toBe(prev.y + prev.h + footers[prevId] + MOBILE_GAP);
    }
  });

  test('接続線の代わりに、つながっている付箋へのボタンが付箋の下に出る', async ({ page }) => {
    await gotoAndSettle(page);

    // 縦 1 列では接続線が出ないので、wema（noteLinks）が相手の付箋をボタンで並べる。
    // 中央の付箋は全部の付箋につながっているので、ここが目次になる
    const links = (id: string) => page.locator(`${NOTE}[data-note-id="${id}"] .wema-note-link`);
    await expect(links('center')).toHaveCount(boardData.edges.length);
    await expect(links('interests')).toHaveText(/KAN Fushihara/);
    // 接続線の無い付箋には出ない
    await expect(links('poweredby')).toHaveCount(0);

    // 文字が背景に沈んでいないこと。wema の既定は白い板に濃い文字で、テーマに
    // 追従しない。矢印は --wema-anchor-color（このサイトでは透明）で塗られる
    const colors = await links('center').first().evaluate((el) => ({
      text: getComputedStyle(el).color,
      arrow: getComputedStyle(el.querySelector('.wema-note-link-arrow')!).color,
      note: getComputedStyle(el.closest('.wema-note')!).color,
    }));
    expect(colors.text).toBe(colors.note);
    expect(colors.arrow).not.toMatch(/rgba\(.*, 0\)|transparent/);

    // 押すと、相手の付箋までページがスクロールする。最後の Interests は最初は画面の外
    const interests = page.locator(`${NOTE}[data-note-id="interests"]`);
    await expect(interests).not.toBeInViewport();
    await links('center').filter({ hasText: 'Interests' }).click();
    await expect(interests).toBeInViewport({ ratio: 1 });

    // 出るのは積んでいる間だけ。広げると接続線に戻る
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('.wema-note-link:visible')).toHaveCount(0);
  });

  test('ホイールでページが最後の付箋までスクロールする', async ({ page }) => {
    await gotoAndSettle(page);

    // 縦積みの間は wema の pageScroll で、ボードのパンではなくページが動く。
    // 切り忘れると、ホイールはボードを動かしてページは 0 のまま残る。
    const last = page.locator(`${NOTE}[data-note-id="${mobileOrder.at(-1)}"]`);
    await expect(last).not.toBeInViewport();

    await page.mouse.move(100, 300);
    await page.mouse.wheel(0, 5000);

    await expect(last).toBeInViewport();
    // スクロールするのは body（html と body の両方が overflow-y: auto なので、
    // window.scrollY は 0 のまま動かない）
    const { scrolled, top } = await page.evaluate((id) => ({
      scrolled: document.body.scrollTop,
      top: document.querySelector(`[data-note-id="${id}"]`)!.getBoundingClientRect().y,
    }), mobileOrder[0]);
    expect(scrolled).toBeGreaterThan(0);
    // 動いたのはページで、ボードの中身は積んだ位置のまま。スクロール量は
    // 端末の画素に丸められて小数になるので、丸めずに足して近さで見る
    expect(top + scrolled).toBeCloseTo(MOBILE_TOP, 0);
  });

  test('接続線も折り畳みボタンも出ず、広げると接続線が戻る', async ({ page }) => {
    await gotoAndSettle(page);

    // wema は、表示だけの縦積み（setStacked()）の間、接続線と畳むボタンを出さない。
    // データごと積む stackNotes() に戻すと、線が付箋の裏を通って隙間に切れ端が見え、
    // 画面の端で切れたボタンが付箋の四辺に出る
    const edges = page.locator('.wema-viewport svg path:visible');
    await expect(edges).toHaveCount(0);
    await expect(page.locator('.wema-note-collapse-btn:visible')).toHaveCount(0);

    // 線を消しているのは積んでいる間だけで、列を抜けると元どおり描かれる
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => edges.count(), { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('畳まれたエッジが展開され、interests ノートも読める', async ({ page }) => {
    await gotoAndSettle(page);

    // デスクトップでは collapsed:true で幅 0。モバイルでは縦積みに入れるために開く
    expect((await noteBoxes(page)).interests.w).toBeGreaterThan(0);
  });

  test('横スクロールが発生しない', async ({ page }) => {
    await gotoAndSettle(page);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
