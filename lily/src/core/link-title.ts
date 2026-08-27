/**
 * 貼り付けた URL からページのタイトルを取る。
 *
 * ブラウザからは CORS で読めないので Worker が代わりに取りに行く。**外から来た
 * URL をそのまま fetch する口**なので、次の 5 つで狭めてある。
 *
 *   1. http / https だけ (file: や data: を弾く)
 *   2. 宛先の検査 (`isAllowed`)。IP リテラルとローカル向けの名前を弾く
 *   3. **リダイレクトは自分で追い、飛び先も毎回検査する。**
 *      `redirect: 'follow'` に任せると、公開 URL から内側へ飛ばされたときに
 *      素通りする (最初の 1 回しか見ないため)
 *   4. 時間の上限
 *   5. 読むのは先頭だけ。`<title>` は `<head>` にあるので全部読む必要がない
 */

const TIMEOUT_MS = 5000;

/** `<title>` を探すのに読む長さ。ここに無ければ諦める。 */
const MAX_BYTES = 64 * 1024;

/** 追うリダイレクトの数。 */
const MAX_REDIRECTS = 3;

/** IPv4 / IPv6 のリテラル。数字で直接指定されたものは通さない。 */
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

/**
 * ローカルや内部向けの名前。IP リテラルを弾くだけでは、`localhost` や
 * `*.internal` のような名前で同じところへ行ける。
 */
const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

export type LinkTitle = { readonly title: string | null };

function isAllowed(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (IP_LITERAL.test(url.hostname)) return false;
  if (LOCAL_NAME.test(url.hostname)) return false;
  return true;
}

export async function fetchLinkTitle(rawUrl: string): Promise<LinkTitle> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { title: null };
  }

  const response = await follow(url);
  if (response === null) return { title: null };
  if (!(response.headers.get('Content-Type') ?? '').includes('html')) return { title: null };

  return { title: extractTitle(await readHead(response)) };
}

/**
 * リダイレクトを自分で追う。**飛び先も毎回 `isAllowed` に通す。**
 *
 * 取れなければ null。理由は返さない (呼び出し側は「題が無い」としてしか扱わない)。
 */
async function follow(start: URL): Promise<Response | null> {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowed(url)) return null;

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
    } catch {
      return null;
    }

    if (response.status < 300 || response.status >= 400) {
      return response.ok ? response : null;
    }

    const location = response.headers.get('Location');
    if (location === null) return null;
    try {
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  return null;
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
