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

const UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPES).map(([c, e]) => [e, c]),
);
const ENTITY = new RegExp(Object.keys(UNESCAPES).join('|'), 'g');

/**
 * `escapeHtml()` の逆。付箋の text から Markdown を組むとき（`src/agent.ts`）に使う。
 * **表は `ESCAPES` から作る**ので、逃がす文字を増やしても取り残されない。
 */
export function unescapeHtml(s: string): string {
  return s.replace(ENTITY, (e) => UNESCAPES[e] ?? e);
}

/** カード右下の「more...」。サイト内（`/blog/`）は同じタブで開く */
export function moreLink(href: string): string {
  const target = href.startsWith('/') ? '' : ' target="_blank"';
  return `<div class="more-link"><a href="${href}"${target}>more...</a></div>`;
}
