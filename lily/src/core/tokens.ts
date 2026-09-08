/**
 * 下書きプレビューのトークン。
 *
 * **生トークンは保存しない。** DB に入るのは SHA-256 の hex だけで、URL を
 * 知っている人だけが下書きを見られる。失効は hash を NULL にするだけ。
 */

import { toHex } from './ids.ts';

const TOKEN_BYTES = 32;

/** URL に置ける形 (base64url) のランダムトークン。 */
export function newPreviewToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function hashPreviewToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}
