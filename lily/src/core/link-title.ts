/**
 * 貼り付けた URL からページのタイトルを取る。
 *
 * ブラウザからは CORS で読めないので Worker が代わりに取りに行く。**外から来た
 * URL をそのまま fetch する口**なので、次の 4 つで狭めてある。
 *
 *   1. http / https だけ (file: や data: を弾く)
 *   2. IP リテラル宛てを弾く (内側を覗きに行かせない)
 *   3. 時間の上限
 *   4. 読むのは先頭だけ。`<title>` は `<head>` にあるので全部読む必要がない
 */

const TIMEOUT_MS = 5000;

/** `<title>` を探すのに読む長さ。ここに無ければ諦める。 */
const MAX_BYTES = 64 * 1024;

/** IPv4 / IPv6 のリテラル。名前で来たものは DNS 任せにする。 */
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

export type LinkTitle = { readonly title: string | null };

export async function fetchLinkTitle(rawUrl: string): Promise<LinkTitle> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { title: null };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { title: null };
  if (IP_LITERAL.test(url.hostname)) return { title: null };

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
  } catch {
    return { title: null };
  }
  if (!response.ok) return { title: null };
  if (!(response.headers.get('Content-Type') ?? '').includes('html')) return { title: null };

  return { title: extractTitle(await readHead(response)) };
}

/** 先頭だけ読む。`<title>` が見つかったらそこで止める。 */
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes('</title>') || text.length >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

function extractTitle(html: string): string | null {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!matched?.[1]) return null;
  const title = decodeEntities(matched[1]).replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}

/** タイトルに出てくる範囲の実体参照だけ戻す。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
}
