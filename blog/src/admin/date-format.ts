/**
 * 管理画面の日付整形。**タイムゾーンを引数で受ける純粋な部品。**
 *
 * 実行環境の TZ に任せない。編集している端末が海外にあっても、入れた日時と
 * 公開ページに出る日付が食い違わないようにするため（公開側の整形はテーマの
 * 持ち物で、fushihara.net では `shared/date.ts` が同じタイムゾーンで組む）。
 *
 * **lily の一部なので、配信するサイトのモジュールを読まない。** 管理画面は
 * どの deployment でも同じ成果物を配るので、日付の規則も設定から受け取る。
 *
 * DOM に触れないのは、`src/admin/date.ts`（サイト設定に束ねたもの）が
 * `document` を読む `site.ts` を経由するため。ここを分けておくと、夏時間を
 * またぐ往復をユニットテストから確かめられる（`test/admin/date-format.test.ts`)。
 */

export type DateFormat = {
  /** `YYYY-MM-DD`。一覧に出す日付。 */
  isoDate(d: Date): string;
  /** `<input type="datetime-local">` に入れる `YYYY-MM-DDTHH:mm`。 */
  toDateTimeInput(d: Date): string;
  /**
   * その逆。`YYYY-MM-DDTHH:mm` を**そのタイムゾーンの日時として**読み、
   * UTC の ISO8601 に戻す。読めない入力は null（呼び出し側が弾く）。
   */
  fromDateTimeInput(value: string): string | null;
};

export function createDateFormat(timeZone: string): DateFormat {
  const ymd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const ymdhm = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = (format: Intl.DateTimeFormat, d: Date): Record<string, string> =>
    Object.fromEntries(format.formatToParts(d).map((part) => [part.type, part.value]));

  /** その瞬間のオフセット（ミリ秒。UTC より東が正）。 */
  const offsetMs = (at: Date): number => {
    const p = parts(ymdhm, at);
    const seen = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    // 分より下は formatToParts に出していないので、比較も分に丸めて行う。
    return seen - Math.floor(at.getTime() / 60000) * 60000;
  };

  return {
    isoDate(d) {
      const p = parts(ymd, d);
      return `${p.year}-${p.month}-${p.day}`;
    },

    toDateTimeInput(d) {
      const p = parts(ymdhm, d);
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    },

    fromDateTimeInput(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
      const asUtc = new Date(`${value}:00Z`);
      if (Number.isNaN(asUtc.getTime())) return null;
      // **オフセットは固定値で書かない。** `+09:00` のように焼き込むと、夏時間の
      // ある地域で年に 2 回 1 時間ずれる。まず UTC として読んだ位置のオフセットを
      // 当て、当てた先のオフセットで測り直す（切り替わりをまたぐと 1 回目が
      // 古い側のものになるため）。
      const guess = new Date(asUtc.getTime() - offsetMs(asUtc));
      const corrected = new Date(asUtc.getTime() - offsetMs(guess));
      return Number.isNaN(corrected.getTime()) ? null : corrected.toISOString();
    },
  };
}
