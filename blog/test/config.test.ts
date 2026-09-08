import { createScheduledController, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { authMode, lily } from '../src/config.ts';
import worker from '../src/index.ts';
import { get, MOUNT, ORIGIN } from './helpers.ts';

describe('認証の配線 (Cloudflare Access)', () => {
  it('Access の設定が無くても実ドメインからは開かない (fail closed)', async () => {
    // **テストとローカルはここが空。** `.dev.vars` が wrangler.jsonc の値
    // (本番の Access) を打ち消しているので、選ばれるのは localhostOnly。
    // Access を手元で再現できない以上この経路が要るが、**実ドメインからは
    // 必ず拒否する**ので、設定を入れ忘れたまま公開しても管理画面は開かない。
    expect(authMode(env)).toBe('localhost');
    expect((await get(`${MOUNT}/api/me`)).status).toBe(403);
    expect((await get(`${MOUNT}/admin/`)).status).toBe(403);
  });

  it('ACCESS の設定が片方でも欠けたら Access にはしない', () => {
    // 片方だけ設定して「Access で守られているつもり」になるのが一番危ない。
    // 実際に選ばれたアダプタは起動時に 1 度だけログへ出る。
    expect(authMode({ ACCESS_TEAM: 'team', ACCESS_AUD: 'aud' })).toBe('access');
    expect(authMode({ ACCESS_TEAM: 'team', ACCESS_AUD: '' })).toBe('localhost');
    expect(authMode({ ACCESS_TEAM: '', ACCESS_AUD: 'aud' })).toBe('localhost');
    expect(authMode({})).toBe('localhost');
  });

  it('公開側は認証を要らない', async () => {
    expect((await get(`${MOUNT}/`)).status).toBe(200);
    expect((await get(`${MOUNT}/rss.xml`)).status).toBe(200);
  });
});

describe('cron の配線', () => {
  async function backupKeys(): Promise<string[]> {
    const listed = await env.BACKUP.list({ prefix: 'archives/' });
    return listed.objects.map((object) => object.key);
  }

  it('scheduled ハンドラが控えを置く', async () => {
    // **エントリごと呼ぶ。** `runBackup` を直接叩くテスト (lily 側) だけだと、
    // `src/index.ts` の配線（binding の名前・保持数の受け渡し）を誰も見ない。
    for (const key of await backupKeys()) await env.BACKUP.delete(key);

    const controller = createScheduledController({
      scheduledTime: new Date('2026-08-30T18:30:00.000Z'),
      cron: '30 18 * * *',
    });
    await worker.scheduled?.(controller, env);

    expect(await backupKeys()).toHaveLength(1);
  });

  it('BACKUP が無ければ何もしない（落とさない）', async () => {
    // 控え先を用意しない構成もあり得る。**エントリが自分で判断する**
    // （lily は BACKUP を要求しない）。
    const controller = createScheduledController({ scheduledTime: new Date(), cron: '30 18 * * *' });
    const without = { ...env, BACKUP: undefined } as unknown as typeof env;

    await expect(
      worker.scheduled?.(controller, without),
    ).resolves.toBeUndefined();
  });
});

describe('lily に渡している設定', () => {
  it('自前のテーマが出ている（標準テーマではない）', async () => {
    const html = await (await get(`${MOUNT}/`)).text();
    // パンくずは fushihara.net の見た目。標準テーマはサイト名 1 つしか出さない。
    expect(html).toContain('fushihara.net');
    expect(html).toContain(`<a href="${MOUNT}/">blog</a>`);
    // 標準テーマの文言が混ざっていないこと。
    expect(html).not.toContain('No posts yet.');
  });

  it('favicon 3 点と og:image の link が実体を指す', async () => {
    // **配線が切れても画面には出ない**ので、link と実体を突き合わせる。
    const html = await (await get(`${MOUNT}/`)).text();
    expect(html).toContain(`href="${MOUNT}/favicon.ico" sizes="32x32"`);
    expect(html).toContain(`href="${MOUNT}/favicon.svg" type="image/svg+xml"`);
    expect(html).toContain(`rel="apple-touch-icon" href="${MOUNT}/apple-touch-icon.png"`);
    expect(html).toContain(`content="${ORIGIN}${MOUNT}/ogp.png"`);

    for (const name of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'ogp.png']) {
      const res = await get(`${MOUNT}/${name}`);
      expect(res.status, name).toBe(200);
      expect((await res.arrayBuffer()).byteLength, name).toBeGreaterThan(0);
    }
  });

  it('favicon.svg がパースできる XML である', async () => {
    // SVG は XML なので、コメントにハイフン 2 個を書くだけで壊れる (実際に踏んだ)。
    // 壊れたファイルも 200 で配信されるので、中身まで見る。
    const svg = await (await get(`${MOUNT}/favicon.svg`)).text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // `<!-- ... -- ... -->` は XML として不正
    expect(svg.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('<!--');
  });

  it('lily のアプリとして組めている（管理画面が保護の内側にある）', async () => {
    expect(lily).toBeTruthy();
    expect((await get(`${MOUNT}/admin/`)).status).toBe(403);
  });
});
