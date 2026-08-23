import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

/**
 * ハンドラは global fetch を直接呼ぶので、テストでは差し替えて上流を止める。
 * こうしないと CI が zenn.dev / api.github.com に依存して不安定になる。
 */
let upstream: ReturnType<typeof vi.fn>;

/** ASSETS バインディングはテストプールに存在しないので、呼ばれたことだけ観測できる形で差す */
let assets: ReturnType<typeof vi.fn>;
let env: Env;

beforeEach(() => {
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);

  assets = vi.fn(async () => new Response('Not Found', { status: 404 }));
  env = { ASSETS: { fetch: assets } } as unknown as Env;
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

/** Worker を 1 リクエスト分呼ぶ。waitUntil の完了まで待つ */
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

// Worker は caches.default を使うので、URL が同じだとテスト間でキャッシュヒットして
// 上流呼び出しが観測できなくなる。既定では毎回ユニークなキーになるようにする
// (Worker は知らないクエリを無視するので、上流 URL や集計結果には影響しない)。
let seq = 0;
function call(path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?';
  return callRaw(`${path}${sep}__t=${++seq}`, init);
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
      const res = await call('/api/zenn', { method });
      expect(res.status, method).toBe(405);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled();
  });
});

describe('入力の検証', () => {
  it('許可していない username は 400 で拒否し、上流を呼ばない', async () => {
    for (const path of [
      '/api/zenn?username=someone-else',
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
    const res = await call('/api/zenn');

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('数値でない limit は既定値に落とす（空配列を返さない）', async () => {
    replyJson([{ language: 'Go', fork: false }]);

    const res = await call('/api/github-languages?username=kan&limit=abc');
    const { languages } = (await res.json()) as { languages: unknown[] };

    expect(res.status).toBe(200);
    expect(languages).toHaveLength(1);
  });

  it('0 以下の limit は既定値に落とす', async () => {
    replyJson([{ language: 'Go', fork: false }, { language: 'Perl', fork: false }]);

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
    replyJson({ articles: [] });

    await call('/api/zenn?username=kan&count=abc');

    expect(lastUpstreamUrl().searchParams.get('count')).toBe('5');
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
    replyJson({ articles: [{ title: '1 回だけ取得' }] });

    const first = await callRaw('/api/zenn?username=kan&count=41');
    const second = await callRaw('/api/zenn?username=kan&count=41');

    expect(upstream).toHaveBeenCalledOnce();
    await expect(first.json()).resolves.toEqual({ articles: [{ title: '1 回だけ取得' }] });
    await expect(second.json()).resolves.toEqual({ articles: [{ title: '1 回だけ取得' }] });
  });

  it('上流が失敗したレスポンスはキャッシュしない', async () => {
    replyJson({ message: 'boom' }, { status: 500 });
    replyJson({ articles: [] }, { status: 200 });

    await callRaw('/api/zenn?username=kan&count=42');
    await callRaw('/api/zenn?username=kan&count=42');

    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe('/api/zenn', () => {
  it('上流のレスポンスを JSON として転送する', async () => {
    replyJson({ articles: [{ title: 'テスト記事' }] });

    const res = await call('/api/zenn?username=kan&count=5');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    await expect(res.json()).resolves.toEqual({ articles: [{ title: 'テスト記事' }] });
  });

  it('クエリを上流 URL に引き渡す', async () => {
    replyJson({ articles: [] });

    await call('/api/zenn?username=kan&count=3');

    const url = lastUpstreamUrl();
    expect(url.origin).toBe('https://zenn.dev');
    expect(url.pathname).toBe('/api/articles');
    expect(url.searchParams.get('username')).toBe('kan');
    expect(url.searchParams.get('count')).toBe('3');
    expect(url.searchParams.get('order')).toBe('latest');
  });

  it('count 未指定なら 5 件を要求する', async () => {
    replyJson({ articles: [] });

    await call('/api/zenn?username=kan');

    expect(lastUpstreamUrl().searchParams.get('count')).toBe('5');
  });

  it('上流のエラーステータスをそのまま返す', async () => {
    replyJson({ message: 'not found' }, { status: 404 });

    const res = await call('/api/zenn?username=kan');

    expect(res.status).toBe(404);
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
  const repos = [
    { language: 'Go', fork: false },
    { language: 'Go', fork: false },
    { language: 'Go', fork: false },
    { language: 'Perl', fork: false },
    { language: 'Perl', fork: false },
    { language: 'TypeScript', fork: false },
    // 集計から外れるはずのもの
    { language: 'Java', fork: true },
    { language: null, fork: false },
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
      Array.from({ length: 8 }, (_, i) => ({ language: `Lang${i}`, fork: false })),
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

  it('上流が失敗したら空配列を返す（ボードは静的テキストのまま残る）', async () => {
    replyJson({ message: 'rate limit' }, { status: 403 });

    const res = await call('/api/github-languages?username=kan');

    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ languages: [] });
  });
});
