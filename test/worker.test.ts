import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { cacheKeys } from '../worker/index';

/**
 * ハンドラは global fetch を直接呼ぶので、テストでは差し替えて上流を止める。
 * こうしないと CI が api.github.com / fushihara.net の生存に依存して不安定になる。
 */
let upstream: ReturnType<typeof vi.fn>;

/** ブログ Worker への service binding (env.BLOG.fetch)。本番の /api/blog はこちらを通る */
let blogService: ReturnType<typeof vi.fn>;

/** ASSETS バインディングはテストプールに存在しないので、呼ばれたことだけ観測できる形で差す */
let assets: ReturnType<typeof vi.fn>;
let env: Env;

beforeEach(() => {
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  blogService = vi.fn();

  assets = vi.fn(async () => new Response('Not Found', { status: 404 }));
  // BLOG はブログ Worker への service binding。上流と同じモックに寄せて、
  // 「RSS を返す上流」としてまとめて観測できるようにする。
  env = { ASSETS: { fetch: assets }, BLOG: { fetch: blogService } } as unknown as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 上流が返す JSON を 1 回分仕込む */
function replyJson(body: unknown, init: { status?: number } = {}) {
  upstream.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Worker を 1 リクエスト分呼ぶ。キャッシュには触らない */
async function callRaw(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  // new Request() は cf プロパティを持たないので、受信リクエストの型に合わせる
  const request = new Request(
    `https://fushihara.net${path}`,
    init,
  ) as unknown as Parameters<typeof worker.fetch>[0];
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const url = (path: string) => new URL(`https://fushihara.net${path}`);

// caches.default はテスト間で生き続けるので、既定では 2 本とも捨ててから呼ぶ。
// キーの導出は Worker と同じ関数を使う（テストだけ別実装にすると、キーの決め方を
// 変えた日にテストが「何も検証していない」側へ倒れる）。
async function call(path: string, init?: RequestInit): Promise<Response> {
  const { primary, backup } = cacheKeys(url(path));
  await caches.default.delete(primary);
  await caches.default.delete(backup);
  return callRaw(path, init);
}

/**
 * 1 時間のキャッシュだけが切れた状態にする。控え (30 日) は残るので、
 * 「上流が落ちたときに控えで凌ぐ」経路をこの後の呼び出しで通せる。
 */
async function expirePrimary(path: string): Promise<void> {
  await caches.default.delete(cacheKeys(url(path)).primary);
}

/** 直近の上流リクエスト URL */
function lastUpstreamUrl(): URL {
  expect(upstream).toHaveBeenCalled();
  return new URL(upstream.mock.calls.at(-1)![0] as string);
}

describe('ルーティング', () => {
  it('未定義のパスは静的アセットに委譲する', async () => {
    const res = await call('/api/does-not-exist');

    expect(assets).toHaveBeenCalledOnce();
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('GET 以外は 405 を返し、上流もアセットも触らない', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await call('/api/blog', { method });
      expect(res.status, method).toBe(405);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled();
  });
});

describe('入力の検証', () => {
  it('許可していない username は 400 で拒否し、上流を呼ばない', async () => {
    for (const path of [
      '/api/github?username=someone-else',
      '/api/github-languages?username=someone-else',
    ]) {
      const res = await call(path);
      expect(res.status, path).toBe(400);
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('username 未指定も拒否する', async () => {
    const res = await call('/api/github');

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('数値でない limit は既定値に落とす（空配列を返さない）', async () => {
    replyJson([{ language: 'Go', fork: false, pushed_at: new Date().toISOString() }]);

    const res = await call('/api/github-languages?username=kan&limit=abc');
    const { languages } = (await res.json()) as { languages: unknown[] };

    expect(res.status).toBe(200);
    expect(languages).toHaveLength(1);
  });

  it('0 以下の limit は既定値に落とす', async () => {
    const now = new Date().toISOString();
    replyJson([
      { language: 'Go', fork: false, pushed_at: now },
      { language: 'Perl', fork: false, pushed_at: now },
    ]);

    const res = await call('/api/github-languages?username=kan&limit=-1');
    const { languages } = (await res.json()) as { languages: unknown[] };

    expect(languages).toHaveLength(2);
  });

  it('count は上限 100 に丸める', async () => {
    replyJson([]);

    await call('/api/github?username=kan&count=9999');

    expect(lastUpstreamUrl().searchParams.get('per_page')).toBe('100');
  });

  it('数値でない count は既定値に落とす', async () => {
    replyJson([]);

    await call('/api/github?username=kan&count=abc');

    expect(lastUpstreamUrl().searchParams.get('per_page')).toBe('10');
  });
});

describe('エラー時のキャッシュ制御', () => {
  it('上流が失敗したらブラウザにもキャッシュさせない', async () => {
    replyJson({ message: 'rate limit' }, { status: 403 });

    const res = await call('/api/github?username=kan');

    expect(res.status).toBe(403);
    // 1 時間キャッシュされると上流が復旧してもカードが壊れたままになる
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('成功時は 1 時間キャッシュさせる', async () => {
    replyJson([]);

    const res = await call('/api/github?username=kan');

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });
});

describe('エッジキャッシュ', () => {
  it('同じ URL の 2 回目は上流を叩かずキャッシュから返す', async () => {
    replyJson([{ name: '1 回だけ取得' }]);

    const first = await call('/api/github?username=kan');
    const second = await callRaw('/api/github?username=kan');

    expect(upstream).toHaveBeenCalledOnce();
    await expect(first.json()).resolves.toEqual([{ name: '1 回だけ取得' }]);
    await expect(second.json()).resolves.toEqual([{ name: '1 回だけ取得' }]);
  });

  it('未知のクエリが付いてもキャッシュを分裂させない', async () => {
    replyJson([{ name: '1 回だけ取得' }]);

    await call('/api/github?username=kan');
    // 共有リンクに付く utm_source などでキーが割れると、中身が同じでも毎回
    // GitHub を叩くことになり、レートリミットをそこで消費してしまう
    const second = await callRaw('/api/github?username=kan&utm_source=x');

    expect(upstream).toHaveBeenCalledOnce();
    await expect(second.json()).resolves.toEqual([{ name: '1 回だけ取得' }]);
  });

  it('解釈するクエリが違えば別のキャッシュになる', async () => {
    replyJson([{ name: '10 件' }]);
    replyJson([{ name: '20 件' }]);

    await call('/api/github?username=kan&count=10');
    // 2 本目はキャッシュを消さずに投げる。キーが割れていなければヒットしてしまう
    const other = await callRaw('/api/github?username=kan&count=20');

    expect(upstream).toHaveBeenCalledTimes(2);
    await expect(other.json()).resolves.toEqual([{ name: '20 件' }]);
  });

  it('上流が失敗したレスポンスはキャッシュしない', async () => {
    replyJson({ message: 'boom' }, { status: 500 });
    replyJson([], { status: 200 });

    await call('/api/github?username=kan');
    await callRaw('/api/github?username=kan');

    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe('上流が落ちたときの控え', () => {
  it('前回成功したレスポンスを返す', async () => {
    replyJson([{ name: '控えに残るリポジトリ' }]);
    replyJson({ message: 'rate limit' }, { status: 403 });

    const ok = await call('/api/github?username=kan');
    await expirePrimary('/api/github?username=kan');
    const failed = await callRaw('/api/github?username=kan');

    expect(ok.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(failed.status).toBe(200);
    expect(failed.headers.get('X-Backup')).toBe('hit');
    await expect(failed.json()).resolves.toEqual([{ name: '控えに残るリポジトリ' }]);
  });

  it('控えを返すときはブラウザに長く持たせない', async () => {
    replyJson([]);
    replyJson({ message: 'rate limit' }, { status: 403 });

    await call('/api/github?username=kan');
    await expirePrimary('/api/github?username=kan');
    const failed = await callRaw('/api/github?username=kan');

    // 上流が復旧しても古いカードが残らないよう、控えは短命にする
    expect(failed.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('控えが無ければ上流のエラーをそのまま返す', async () => {
    replyJson({ message: 'rate limit' }, { status: 403 });

    const res = await call('/api/github?username=kan');

    expect(res.status).toBe(403);
    expect(res.headers.get('X-Backup')).toBeNull();
  });

  it('集計するエンドポイントでも効く', async () => {
    replyJson([{ language: 'Go', fork: false, pushed_at: new Date().toISOString() }]);
    replyJson({ message: 'rate limit' }, { status: 403 });

    await call('/api/github-languages?username=kan');
    await expirePrimary('/api/github-languages?username=kan');
    const failed = await callRaw('/api/github-languages?username=kan');

    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual({ languages: [{ name: 'Go', count: 1 }] });
  });

  it('ハンドラが例外を投げても控えを引く', async () => {
    replyJson([{ name: '控えに残るリポジトリ' }]);
    // fetch は DNS / TLS の失敗やサブリクエストの上限で reject する
    upstream.mockRejectedValueOnce(new Error('boom'));

    await call('/api/github?username=kan');
    await expirePrimary('/api/github?username=kan');
    const failed = await callRaw('/api/github?username=kan');

    expect(failed.status).toBe(200);
    expect(failed.headers.get('X-Backup')).toBe('hit');
  });

  it('例外で控えも無ければ 502 を返す（Worker ごと落とさない）', async () => {
    upstream.mockRejectedValueOnce(new Error('boom'));

    const res = await call('/api/github?username=kan');

    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('別のエンドポイントの控えを取り違えない', async () => {
    replyJson([{ name: 'repo' }]);
    blogService.mockResolvedValueOnce(new Response('boom', { status: 502 }));

    await call('/api/github?username=kan');
    const failed = await call('/api/blog');

    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ posts: [] });
  });
});

describe('/api/blog', () => {
  /** ブログの RSS を組み立てる。@astrojs/rss と同じく実体参照でエスケープする */
  function rss(items: { title: string; link: string; pubDate?: string; content?: string }[]) {
    const escape = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = items
      .map(
        (i) =>
          `<item><title>${escape(i.title)}</title><link>${i.link}</link>` +
          `<pubDate>${i.pubDate ?? 'Mon, 24 Aug 2026 00:00:00 GMT'}</pubDate>` +
          (i.content === undefined ? '' : `<content:encoded>${escape(i.content)}</content:encoded>`) +
          '</item>',
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${body}</channel></rss>`;
  }

  /** binding 越しに RSS を 1 回分返す */
  function replyRss(items: Parameters<typeof rss>[0], init: { status?: number } = {}) {
    blogService.mockResolvedValueOnce(
      new Response(rss(items), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      }),
    );
  }

  const post = { title: '記事タイトル', link: 'https://fushihara.net/blog/foo/' };

  it('ブログ Worker への binding 経由で RSS を読む', async () => {
    // 同一ゾーンの URL を素の fetch で叩くと Worker ルートが再実行されず、
    // origin へ向かって 522 になる (本番で踏んだ)。binding を通すこと。
    replyRss([post]);

    await call('/api/blog');

    expect(blogService).toHaveBeenCalledOnce();
    expect(new URL(blogService.mock.calls[0][0] as string).href)
      .toBe('https://fushihara.net/blog/rss.xml');
  });

  it('ローカル (dev / preview) では公開 URL を直接読む', async () => {
    // dev には別 Worker のセッションが無く、binding は 503 しか返さない
    upstream.mockResolvedValueOnce(new Response(rss([post]), { status: 200 }));

    const ctx = createExecutionContext();
    const request = new Request(
      'http://localhost:5173/api/blog',
    ) as unknown as Parameters<typeof worker.fetch>[0];
    const res = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(blogService).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('RSS を title / link / date の JSON に均す', async () => {
    replyRss([{ ...post, pubDate: 'Mon, 24 Aug 2026 15:00:00 GMT' }]);

    const res = await call('/api/blog');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    await expect(res.json()).resolves.toEqual({
      posts: [
        {
          title: '記事タイトル',
          link: 'https://fushihara.net/blog/foo/',
          date: '2026-08-24T15:00:00.000Z',
        },
      ],
    });
  });

  it('タイトルの実体参照を戻す', async () => {
    replyRss([{ ...post, title: 'A & B <script> 「引用」' }]);

    const res = await call('/api/blog');
    const { posts } = (await res.json()) as { posts: { title: string }[] };

    expect(posts[0].title).toBe('A & B <script> 「引用」');
  });

  it('全文 (content:encoded) に item や title があっても記事を取り違えない', async () => {
    // 本文に生の HTML を書ける (CommonMark) ので、item の切れ目を偽装しうる文字列を入れる
    replyRss([
      { ...post, content: '<item><title>本文の中の偽物</title></item> 本文' },
      { ...post, title: '2 本目', link: 'https://fushihara.net/blog/bar/' },
    ]);

    const res = await call('/api/blog');
    const { posts } = (await res.json()) as { posts: { title: string }[] };

    expect(posts.map((p) => p.title)).toEqual(['記事タイトル', '2 本目']);
  });

  it('日付が読めない記事も落とさず、date だけ空にする', async () => {
    replyRss([{ ...post, pubDate: 'never' }]);

    const res = await call('/api/blog');
    const { posts } = (await res.json()) as { posts: { date: string }[] };

    expect(posts).toHaveLength(1);
    expect(posts[0].date).toBe('');
  });

  const many = Array.from({ length: 30 }, (_, i) => ({
    title: `記事 ${i}`,
    link: `https://fushihara.net/blog/p${i}/`,
  }));

  it('count 未指定なら 5 件に絞る', async () => {
    replyRss(many);

    const res = await call('/api/blog');
    const { posts } = (await res.json()) as { posts: unknown[] };

    expect(posts).toHaveLength(5);
  });

  it('count で件数を指定できる', async () => {
    replyRss(many);

    const res = await call('/api/blog?count=3');
    const { posts } = (await res.json()) as { posts: unknown[] };

    expect(posts).toHaveLength(3);
  });

  it('count は上限 20 に丸める', async () => {
    replyRss(many);

    const res = await call('/api/blog?count=999');
    const { posts } = (await res.json()) as { posts: unknown[] };

    expect(posts).toHaveLength(20);
  });

  it('解釈できない RSS は上流の異常として扱う', async () => {
    // 200 でも中身が取れないなら、空の控えを 30 日書かせない
    blogService.mockResolvedValueOnce(new Response('<html>maintenance</html>', { status: 200 }));

    const res = await call('/api/blog');

    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ posts: [] });
  });

  it('解釈できない RSS が来ても前回の控えを潰さない', async () => {
    replyRss([post]);
    blogService.mockResolvedValueOnce(new Response('<html>maintenance</html>', { status: 200 }));

    await call('/api/blog');
    await expirePrimary('/api/blog');
    const res = await callRaw('/api/blog');

    expect(res.headers.get('X-Backup')).toBe('hit');
    const { posts } = (await res.json()) as { posts: { title: string }[] };
    expect(posts.map((p) => p.title)).toEqual(['記事タイトル']);
  });

  it('RSS が引けなければ空配列を返す（ボードは静的テキストのまま残る）', async () => {
    blogService.mockResolvedValueOnce(new Response('boom', { status: 502 }));

    const res = await call('/api/blog');

    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ posts: [] });
  });
});

describe('/api/github', () => {
  it('リポジトリ一覧を pushed 順で要求する', async () => {
    replyJson([]);

    await call('/api/github?username=kan&count=10');

    const url = lastUpstreamUrl();
    expect(url.origin).toBe('https://api.github.com');
    expect(url.pathname).toBe('/users/kan/repos');
    expect(url.searchParams.get('sort')).toBe('pushed');
    expect(url.searchParams.get('per_page')).toBe('10');
  });

  it('count 未指定なら 10 件を要求する', async () => {
    replyJson([]);

    await call('/api/github?username=kan');

    expect(lastUpstreamUrl().searchParams.get('per_page')).toBe('10');
  });

  it('GitHub API 用のヘッダを付ける', async () => {
    replyJson([]);

    await call('/api/github?username=kan');

    const init = upstream.mock.calls.at(-1)![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/vnd.github.v3+json');
    expect(headers.get('User-Agent')).toBe('fushihara-net-portfolio');
  });
});

describe('/api/github-languages', () => {
  /** 直近に触ったリポジトリ。集計対象の既定 */
  const recently = new Date().toISOString();
  /** 集計の窓 (3 年) から外れる古いリポジトリ */
  const longAgo = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  const repo = (language: string | null, extra: Record<string, unknown> = {}) => ({
    language,
    fork: false,
    pushed_at: recently,
    ...extra,
  });

  const repos = [
    repo('Go'),
    repo('Go'),
    repo('Go'),
    repo('Perl'),
    repo('Perl'),
    repo('TypeScript'),
    // 集計から外れるはずのもの
    repo('Java', { fork: true }),
    repo(null),
  ];

  it('非 fork の language を頻度順に集計する', async () => {
    replyJson(repos);

    const res = await call('/api/github-languages?username=kan&limit=8');

    await expect(res.json()).resolves.toEqual({
      languages: [
        { name: 'Go', count: 3 },
        { name: 'Perl', count: 2 },
        { name: 'TypeScript', count: 1 },
      ],
    });
  });

  it('fork と language が null のリポジトリを除外する', async () => {
    replyJson(repos);

    const res = await call('/api/github-languages?username=kan');
    const { languages } = (await res.json()) as { languages: { name: string }[] };

    expect(languages.map((l) => l.name)).not.toContain('Java');
  });

  it('limit で上位のみに絞る', async () => {
    replyJson(repos);

    const res = await call('/api/github-languages?username=kan&limit=2');
    const { languages } = (await res.json()) as { languages: { name: string }[] };

    expect(languages.map((l) => l.name)).toEqual(['Go', 'Perl']);
  });

  it('limit 未指定なら 5 件に絞る', async () => {
    replyJson(
      Array.from({ length: 8 }, (_, i) => ({
        language: `Lang${i}`,
        fork: false,
        pushed_at: new Date().toISOString(),
      })),
    );

    const res = await call('/api/github-languages?username=kan');
    const { languages } = (await res.json()) as { languages: unknown[] };

    expect(languages).toHaveLength(5);
  });

  it('集計対象を広く取るため 100 件まで取得する', async () => {
    replyJson([]);

    await call('/api/github-languages?username=kan&limit=5');

    expect(lastUpstreamUrl().searchParams.get('per_page')).toBe('100');
  });

  it('スキルとして意味の無い language を除外する', async () => {
    // 「Dockerfile が書けます」は読み手に何も伝えない
    replyJson([
      repo('Go'), repo('Dockerfile'), repo('Shell'), repo('Makefile'),
      repo('HTML'), repo('PowerShell'),
    ]);

    const res = await call('/api/github-languages?username=kan');
    const { languages } = (await res.json()) as { languages: { name: string }[] };

    expect(languages.map((l) => l.name)).toEqual(['Go']);
  });

  it('古いリポジトリは数えない（今書いている言語に寄せる）', async () => {
    // リポジトリ数の累積は「昔たくさん書いた言語」に引っ張られる
    replyJson([
      repo('Perl', { pushed_at: longAgo }),
      repo('Perl', { pushed_at: longAgo }),
      repo('Perl', { pushed_at: longAgo }),
      repo('Go'),
    ]);

    const res = await call('/api/github-languages?username=kan');
    const { languages } = (await res.json()) as { languages: { name: string }[] };

    expect(languages.map((l) => l.name)).toEqual(['Go']);
  });

  it('直近に何も触っていなければ全期間で数える（空のカードを出さない）', async () => {
    replyJson([repo('Perl', { pushed_at: longAgo }), repo('Go', { pushed_at: longAgo })]);

    const res = await call('/api/github-languages?username=kan');
    const { languages } = (await res.json()) as { languages: { name: string }[] };

    expect(languages.map((l) => l.name).sort()).toEqual(['Go', 'Perl']);
  });

  it('上流が失敗したら空配列を返す（ボードは静的テキストのまま残る）', async () => {
    replyJson({ message: 'rate limit' }, { status: 403 });

    const res = await call('/api/github-languages?username=kan');

    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ languages: [] });
  });
});
