/**
 * ハッシュのルータ。
 *
 * `<mount>/admin/` がどこにマウントされても動き、サーバー側の設定も要らない。
 * 画面が少ないので、ライブラリを足すより短く済む。
 */
import { computed, ref } from 'vue';
import { ADMIN_HASH } from '../core/paths.ts';

const hash = ref(currentHash());

addEventListener('hashchange', () => {
  hash.value = currentHash();
});

function currentHash(): string {
  return location.hash.slice(1) || '/';
}

export type Route =
  | { readonly name: 'list' }
  | { readonly name: 'settings' }
  | { readonly name: 'editor'; readonly publicId: string | null };

export const route = computed<Route>(() => {
  const path = hash.value;
  if (path === '/settings') return { name: 'settings' };
  if (path === NEW_POST_ROUTE) return { name: 'editor', publicId: null };
  // **接頭辞は組む側と同じものを使う。** 公開ページの編集リンク
  // (`src/site/layout.ts` が `urls.adminPost()` で組む) と食い違うと、
  // 押しても一覧が開くだけで気付けない。
  if (path.startsWith(ADMIN_HASH.postPrefix)) {
    const publicId = decodeURIComponent(path.slice(ADMIN_HASH.postPrefix.length));
    if (publicId !== '') return { name: 'editor', publicId };
  }
  return { name: 'list' };
});

/** 記事を開くハッシュ。`go()` に渡す。 */
export function postRoute(publicId: string): string {
  return `${ADMIN_HASH.postPrefix}${publicId}`;
}

/** 新規作成の画面。**記事の identity は uuid なので `new` と衝突しない。** */
export const NEW_POST_ROUTE = `${ADMIN_HASH.postPrefix}new`;

export function go(path: string): void {
  location.hash = path;
}
