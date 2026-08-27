import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkTitle } from '../../src/core/link-title.ts';

/**
 * **外から来た URL をそのまま fetch する口**なので、通る側だけでなく
 * 「取りに行かない」側を揃えて確かめる。
 */
function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    ...init,
  });
}

let requested: string[] = [];

beforeEach(() => {
  requested = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return html('<html><head><title>ページの題</title></head><body>x</body></html>');
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('取りに行くもの', () => {
  it('title を返す', async () => {
    expect(await fetchLinkTitle('https://example.com/a')).toEqual({ title: 'ページの題' });
  });

  it('実体参照を戻し、空白を畳む', async () => {
    vi.stubGlobal('fetch', async () =>
      html('<title>\n  A &amp; B &#x2014; C\n</title>'),
    );
    expect(await fetchLinkTitle('https://example.com/')).toEqual({ title: 'A & B — C' });
  });
});

describe('取りに行かないもの', () => {
  async function skipped(url: string): Promise<void> {
    expect(await fetchLinkTitle(url), url).toEqual({ title: null });
    expect(requested, url).toEqual([]);
  }

  it('http / https 以外', async () => {
    await skipped('file:///etc/passwd');
    await skipped('data:text/html,<title>x</title>');
    await skipped('ftp://example.com/');
  });

  it('IP リテラル宛て (内側を覗きに行かせない)', async () => {
    await skipped('http://127.0.0.1/');
    await skipped('http://169.254.169.254/latest/meta-data/');
    await skipped('http://[::1]/');
  });

  it('URL として読めないもの', async () => {
    await skipped('とりあえずメモ');
  });
});

describe('取れなかったとき', () => {
  it('HTML でなければ、中に <title> があっても使わない', async () => {
    // 任意のバイト列を HTML として読まないための線。RSS のように `<title>` を
    // 持つ形式もあるので、「見つかったか」ではなく Content-Type で決める。
    vi.stubGlobal('fetch', async () =>
      new Response('<rss><channel><title>フィードの題</title></channel></rss>', {
        headers: { 'Content-Type': 'application/xml' },
      }),
    );
    expect(await fetchLinkTitle('https://example.com/rss.xml')).toEqual({ title: null });
  });

  it('エラーでも落ちない', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('つながらない'); });
    expect(await fetchLinkTitle('https://example.com/')).toEqual({ title: null });

    vi.stubGlobal('fetch', async () => html('x', { status: 500 }));
    expect(await fetchLinkTitle('https://example.com/')).toEqual({ title: null });
  });

  it('title が無ければ null', async () => {
    vi.stubGlobal('fetch', async () => html('<html><body>題が無い</body></html>'));
    expect(await fetchLinkTitle('https://example.com/')).toEqual({ title: null });
  });
});
