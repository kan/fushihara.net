/**
 * ノートの text を組み立てるための小物。`board-data.ts`（静的な文言）と
 * `main.ts`（動的データの反映）の両方から使う。
 *
 * DOM に触れないので、ボードを起こさずにテストできる。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
};

/**
 * ノートの text は HTML なので、外から来た文字列はそのまま混ぜない。wema の
 * サニタイザがタグは落とすが、記号が化けたり属性を抜けられたりはする。
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/** カード右下の「more...」。サイト内（`/blog/`）は同じタブで開く */
export function moreLink(href: string): string {
  const target = href.startsWith('/') ? '' : ' target="_blank"';
  return `<div class="more-link"><a href="${href}"${target}>more...</a></div>`;
}
