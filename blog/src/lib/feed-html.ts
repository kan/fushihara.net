/**
 * 記事ページと同じ HTML を RSS に載せるための後処理。
 *
 * ページの中では正しく動く書き方でも、リーダーの中では前提が崩れる:
 *   - 相対 URL … リーダーは記事の URL を起点に解決してくれない
 *   - CSS 変数 … リーダーはこのブログのスタイルシートを読み込まない
 *
 * どちらもここで潰す。Astro の API には触れていないので、生成器を差し替えても
 * そのまま使える (`rss.xml.ts` から本文 HTML と記事 URL を渡すだけ)。
 *
 * **前提**: 属性はダブルクォートで囲まれている。HTML シリアライザの既定がそれで、
 * 値の中の `"` は実体参照に逃がされる。記事に生 HTML を書くと Markdown の
 * パススルーでそのまま出るので、`href='./x'` のような書き方だけは絶対化されない。
 */

/**
 * 開始タグ 1 つ。引用符の中をひとまとまりで食べるので、属性値に `>` があっても
 * そこで切れない (シリアライザは属性値の `>` を素のまま出す)。
 */
const OPEN_TAG = /<[a-z][a-z0-9-]*(?:"[^"]*"|[^>"])*>/gi;

/**
 * 絶対化と色の展開をまとめて掛ける。
 *
 * **書き換えは開始タグの中だけで行う。** HTML 全体に正規表現を掛けると、
 * コードブロックに書いた `<img src="./dog.png">` のような**本文**まで
 * 書き換えてしまう。text ノードでは `<` と `>` はエスケープされるが `"` は
 * 生のまま残るので、属性だけを狙った正規表現がそのまま食い付く。
 */
export function toFeedHtml(html: string, postUrl: URL): string {
  return html.replace(OPEN_TAG, (tag) => expandShikiColors(absolutizeUrls(tag, postUrl)));
}

/**
 * `src` / `href` を記事の URL 基準で絶対化する。
 *
 * 実測で出た相対 URL は 3 種類:
 *   /blog/_astro/foo.svg    画像パイプラインの出力
 *   #user-content-fn-x      脚注のアンカー
 *   ../../../CONTRACT.md    記事内の相対リンク
 * `new URL()` は絶対 URL や mailto: / data: をそのまま返すので、素通しでよい。
 *
 * `srcset` は扱わない。今の画像出力は常に `srcset=""` で、書いても到達しない
 * コードになる。相対のまま出るようになったら E2E の「相対 URL が残らない」が落ちる。
 */
function absolutizeUrls(tag: string, postUrl: URL): string {
  return tag.replace(/\s(src|href)="([^"]*)"/g, (whole, attr: string, value: string) => {
    const resolved = resolve(value, postUrl);
    return resolved === null ? whole : ` ${attr}="${resolved}"`;
  });
}

/** 解決できない値は書き換えずに残す (壊すより素通しの方が実害が小さい) */
function resolve(value: string, base: URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/**
 * Shiki の CSS 変数をライトテーマの色に展開する。
 *
 * このブログは `defaultColor: false` なので、Shiki は色を直接書かず
 * `--shiki-light` / `--shiki-dark` だけを出す。ページ側はそれを
 * `blog/src/styles/blog.css` の `light-dark()` に渡している (変数名を増やすなら
 * 両方直すこと)。リーダーにはその CSS が無いので、RSS でだけライト側の値を
 * ベタの色にする。
 */
function expandShikiColors(tag: string): string {
  return tag.replace(/\sstyle="([^"]*)"/g, (whole, style: string) => {
    if (!style.includes('--shiki-')) return whole;
    const expanded = style
      .replace(/--shiki-dark(-bg)?:[^;]*;?/g, '')
      .replace('--shiki-light-bg:', 'background-color:')
      .replace('--shiki-light:', 'color:');
    return ` style="${expanded}"`;
  });
}
