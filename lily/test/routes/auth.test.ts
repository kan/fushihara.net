import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { lily } from '../../src/config.ts';
import { get, getRoot, setStubUser, SITE } from './helpers.ts';

afterEach(() => setStubUser(null));

describe('保護境界', () => {
  it('未認証の /api/* は JSON で 403 を返し、残さない', async () => {
    const res = await getRoot('/api/me');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('未認証の /admin/* は 403 (中身がまだ無くても)', async () => {
    const res = await getRoot('/admin/');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('拒否した理由はレスポンスに載せない', async () => {
    // どこまで合っていたかを教えると、当てにいく手掛かりになる。
    const body = await (await getRoot('/api/me')).text();
    expect(body).not.toContain('スタブ');
    expect(body).not.toContain('reason');
  });

  it('認証が通れば誰として入っているかを返す', async () => {
    setStubUser({ id: 'user-1', email: 'kan@example.com' });
    const res = await getRoot('/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: 'user-1', email: 'kan@example.com' } });
  });

  it('認証が通っても、まだ無い管理画面は 404', async () => {
    setStubUser({ id: 'user-1' });
    expect((await getRoot('/admin/')).status).toBe(404);
  });

  it('公開側は認証を要らない', async () => {
    expect((await getRoot('/')).status).toBe(200);
    expect((await getRoot('/rss.xml')).status).toBe(200);
  });
});

describe('本番の設定 (Cloudflare Access)', () => {
  it('ACCESS_TEAM / ACCESS_AUD が空なら必ず拒否する (fail closed)', async () => {
    // 設定を入れ忘れたまま動かしても、管理画面が開いてしまうことはない。
    expect(env.ACCESS_TEAM).toBe('');
    expect((await get('/blog/api/me')).status).toBe(403);
    expect((await get('/blog/admin/')).status).toBe(403);
  });

  it('スタブではなく実物のアダプタが掛かっている', async () => {
    // テスト用スタブを通すと素通りしてしまうので、本番アプリが Access を
    // 使っていることをここで確かめる。
    setStubUser({ id: 'user-1' });
    const res = await lily.fetch(new Request(`${SITE}/blog/api/me`), env);
    expect(res.status).toBe(403);
  });
});
