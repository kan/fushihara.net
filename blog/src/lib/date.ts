/**
 * 日付は常に日本時間で切り出す。実行環境の TZ に依存させないため、UTC でも
 * ローカルでもなく Asia/Tokyo を明示する。
 *
 * frontmatter の `2026-08-23` は UTC 深夜の Date になるので、ローカル整形だと
 * 環境次第で 1 日ずれる。かといって UTC で切り出すと、今度は時刻付きで書いた
 * `2026-08-23T08:00:00+09:00` が前日として表示される (実測で踏んだ)。
 * どちらも起きないのが JST 固定。
 */
const jstYmd = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function isoDate(d: Date): string {
  const p = Object.fromEntries(jstYmd.formatToParts(d).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function displayDate(d: Date): string {
  return isoDate(d).replaceAll('-', '/');
}
