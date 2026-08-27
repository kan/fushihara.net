/**
 * ハッシュのルータ。
 *
 * `<mount>/admin/` がどこにマウントされても動き、サーバー側の設定も要らない。
 * 画面が 2 つしかないので、ライブラリを足すより短く済む。
 */
import { computed, ref } from 'vue';

const hash = ref(currentHash());

addEventListener('hashchange', () => {
  hash.value = currentHash();
});

function currentHash(): string {
  return location.hash.slice(1) || '/';
}

export type Route =
  | { readonly name: 'list' }
  | { readonly name: 'editor'; readonly publicId: string | null };

export const route = computed<Route>(() => {
  const path = hash.value;
  if (path === '/posts/new') return { name: 'editor', publicId: null };
  const matched = /^\/posts\/(.+)$/.exec(path);
  if (matched?.[1]) return { name: 'editor', publicId: matched[1] };
  return { name: 'list' };
});

export function go(path: string): void {
  location.hash = path;
}
