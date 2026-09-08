/**
 * 管理画面の日付。**サイトのタイムゾーン（`SiteConfig.timeZone`）で切り出す。**
 *
 * 規則そのものは `date-format.ts`（DOM に触れない純粋な部品）にあり、ここは
 * 設定に束ねるだけ。`site.ts` が `document` を読むので、分けておかないと
 * 日付の規則をユニットテストから読めない。
 */
import { createDateFormat } from './date-format.ts';
import { SITE } from './site.ts';

export const { isoDate, toDateTimeInput, fromDateTimeInput } = createDateFormat(SITE.timeZone);
