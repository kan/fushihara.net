/**
 * 日付は常に日本時間で切り出す。本体サイト（Blog 付箋）とブログの両方が読む。
 * 片方だけ別実装にすると、同じ記事の日付が `/` と `/blog/` でずれる。
 *
 * 実行環境の TZ に依存させないため、UTC でもローカルでもなく Asia/Tokyo を明示する。
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

/**
 * 日時の編集用。`<input type="datetime-local">` に入れる `YYYY-MM-DDTHH:mm`。
 *
 * **JST で組み立てる。** 表示もフィードも Asia/Tokyo 基準なので、入力だけ
 * ブラウザのタイムゾーンに任せると、書いた日時と出る日付がずれる。
 */
const jstParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function toDateTimeInput(d: Date): string {
  const p = Object.fromEntries(jstParts.formatToParts(d).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * その逆。`YYYY-MM-DDTHH:mm` を **JST の日時として**読み、UTC の ISO8601 に戻す。
 *
 * 日本にサマータイムは無いので、オフセットは +09:00 で固定してよい。
 * 読めない入力は null（呼び出し側が弾く）。
 */
export function fromDateTimeInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
