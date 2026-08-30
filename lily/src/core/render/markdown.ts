/**
 * Markdown を**組み立てる**側の小物。読む側 (`renderMarkdown`) と対にしてある。
 *
 * 管理画面が本文に差し込む記法をここに置くのは、「どう書けば解決されるか」が
 * renderer の知識だから。エディタ側に置くと、renderer を変えたときに
 * 追随し忘れる。
 */

/** 素のままでは書けない文字。空白は記法として解析されず、括弧は対応が崩れる。 */
const NEEDS_BRACKETS = /[\s()]/;

/**
 * 記事に貼る画像の記法。
 *
 * ファイル名に空白があると `![](./my photo.png)` は**画像として解析されない**
 * (CommonMark はリンク先に空白を許さない)。その場合は `<…>` で囲む。
 * percent encoding でも解決はできるが、本文と export の可読性が落ちるので
 * ファイル名はそのまま残す。
 */
export function imageMarkdown(filename: string, alt = ''): string {
  const target = `./${filename}`;
  return `![${alt}](${NEEDS_BRACKETS.test(filename) ? `<${target}>` : target})`;
}

/**
 * カーソルがリンク記法・画像記法の URL 部分 (`](` と `)` のあいだ) にいるか。
 *
 * 直前の `](` を探して、そこから先に閉じ括弧も改行も無ければ中にいる。**閉じ括弧が
 * 無いまま行が終わる書きかけ**も中と見なすので、`[題](` まで打った続きに貼る形が通る。
 *
 * 判定がここにあるのは `imageMarkdown` と同じ理由で、「どこが URL 欄か」が記法の
 * 知識だから。エディタ側に置くと記法を変えたときに追随し忘れる。
 */
export function inLinkUrl(text: string, at: number): boolean {
  const open = text.lastIndexOf('](', at);
  // `at` が `]` と `(` のあいだなら、まだ URL 部分に入っていない。
  if (open < 0 || open + 2 > at) return false;
  return !/[)\n]/.test(text.slice(open + 2, at));
}
