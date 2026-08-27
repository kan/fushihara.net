/**
 * 本文の相対参照 (`./sample.png`) を placeholder に置き換える rehype プラグイン。
 *
 * 突き合わせの規則は `toPlaceholder` の 1 本だけ。Markdown の画像記法 (要素) でも、
 * 記事に直接書いた生 HTML (raw ノード) でも同じ扱いにする。**コードブロックや
 * inline code は text ノードなので触らない。**
 */
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { MediaRef } from '../paths.ts';
import { mapOpenTags } from './html.ts';
import { mediaPlaceholder } from './placeholder.ts';

/** URL を持つ属性。フィードの絶対化と同じ範囲に揃えてある。 */
const URL_ATTRIBUTES = ['src', 'href'] as const;

/**
 * 開始タグの中の `src` / `href`。
 *
 * **大小文字とクォートの形を選ばない。** 記事に直接書く HTML は
 * `SRC=` でも `src='...'` でも `src=x.png` でもありうる。ここが狭いと、
 * 相対参照が解決されないまま配信物に残り、しかも `onUnresolved` にも
 * 出ないので警告にすら現れない (レビューで実測)。
 */
const TAG_ATTRIBUTE = new RegExp(
  `\\s(${URL_ATTRIBUTES.join('|')})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`,
  'gi',
);

/** 属性値からクォートを外す。 */
function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") && value.endsWith(first) ? value.slice(1, -1) : value;
}

export type MediaPluginOptions = {
  /** この記事に紐づく添付。`filename` で突き合わせる。 */
  readonly media: readonly MediaRef[];
  /** 解決できなかった `./…` の参照。管理画面の警告に使う。 */
  readonly onUnresolved: (reference: string) => void;
};

export function rehypeMedia(options: MediaPluginOptions) {
  const byFilename = new Map(options.media.map((m) => [m.filename, m]));

  /** 置き換えるなら placeholder、そうでなければ null。 */
  const toPlaceholder = (value: string): string | null => {
    const filename = relativeFilename(value);
    if (filename === null) return null;

    const media = byFilename.get(filename);
    if (media) return mediaPlaceholder(media);
    // `./` で書いたのに添付が無い＝画像を貼り忘れている可能性が高い。
    // 素の `foo.md` は記事間リンクのことが多いので黙って通す。
    if (value.startsWith('./')) options.onUnresolved(value);
    return null;
  };

  return (tree: Root): void => {
    visit(tree, (node) => {
      if (node.type === 'element') {
        const element = node as Element;
        for (const attribute of URL_ATTRIBUTES) {
          const value = element.properties[attribute];
          if (typeof value !== 'string') continue;
          const placeholder = toPlaceholder(value);
          if (placeholder !== null) element.properties[attribute] = placeholder;
        }
        return;
      }
      if (node.type === 'raw') {
        // 生 HTML はパースせず文字列のまま運んでいるので、ここだけ文字列で扱う。
        // 書き換えるのは開始タグの中だけ (`mapOpenTags`)。
        const raw = node as { value: string };
        raw.value = mapOpenTags(raw.value, (tag) =>
          tag.replace(TAG_ATTRIBUTE, (whole, attribute: string, value: string) => {
            // placeholder には `"` が入らないので、書き換えるときは必ず二重引用符で囲める
            const placeholder = toPlaceholder(unquote(value));
            return placeholder === null ? whole : ` ${attribute}="${placeholder}"`;
          }),
        );
      }
    });
  };
}

/**
 * 同じディレクトリのファイル名なら返す。
 *
 * `media.filename` は `/` を含めない (DB の CHECK) ので、突き合わせられるのは
 * 記事と同じ階層のものだけ。import / export のレイアウトもそうなっている。
 */
function relativeFilename(value: string): string | null {
  if (value === '' || value.startsWith('#') || value.startsWith('?')) return null;
  // mailto: / data: / https: などのスキーム付きは対象外
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  const bare = value.startsWith('./') ? value.slice(2) : value;
  if (bare === '' || bare.includes('/')) return null;

  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}
