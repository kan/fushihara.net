import { describe, expect, it } from 'vitest';
import { fromDateTimeInput, isoDate, toDateTimeInput } from '../../shared/date.ts';
import { createDateFormat } from '../src/core/date.ts';
import { SITE } from '../src/site/meta.ts';

/**
 * 公開日時の編集は JST で行う。表示もフィードも Asia/Tokyo 基準なので、入力だけ
 * ブラウザのタイムゾーンに任せると、書いた日時と出る日付がずれる。
 */
describe('日時の編集', () => {
  it('UTC を JST の裸の日時にする', () => {
    // 2026-08-01T00:00:00Z は JST では同じ日の 9 時
    expect(toDateTimeInput(new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08-01T09:00');
    // 日付をまたぐ側
    expect(toDateTimeInput(new Date('2026-08-01T15:30:00.000Z'))).toBe('2026-08-02T00:30');
  });

  it('JST の裸の日時を UTC に戻す', () => {
    expect(fromDateTimeInput('2026-08-01T09:00')).toBe('2026-08-01T00:00:00.000Z');
    expect(fromDateTimeInput('2026-08-02T00:30')).toBe('2026-08-01T15:30:00.000Z');
  });

  it('往復しても変わらない', () => {
    for (const iso of ['2026-01-01T00:00:00.000Z', '2026-08-01T15:30:00.000Z']) {
      expect(fromDateTimeInput(toDateTimeInput(new Date(iso)))).toBe(iso);
    }
  });

  it('読めない入力は null', () => {
    for (const value of ['', '2026-08-01', 'とりあえず', '2026-13-45T99:99']) {
      expect(fromDateTimeInput(value), value).toBeNull();
    }
  });

  it('表示の日付と食い違わない', () => {
    // 一覧に出る日付 (isoDate) と、編集欄に出る日付が同じ日を指すこと
    const date = new Date('2026-08-01T15:30:00.000Z');
    expect(toDateTimeInput(date).slice(0, 10)).toBe(isoDate(date));
  });
});

/**
 * 公開ページは `shared/date.ts`（本体サイトと共用なので設定を読めない）、管理画面は
 * `SiteConfig.timeZone` で日付を組む。**片方だけ動かすと、編集画面で入れた日時と
 * `/blog/` に出る日付が食い違う。**
 *
 * コメントで「同じ値にすること」と書くだけだと、動かした日に気付けない。出力そのものを
 * 突き合わせておけば、`SITE.timeZone` を変えた時点でここが落ちる。
 */
describe('公開ページと管理画面のタイムゾーン', () => {
  it('同じ瞬間から同じ日付・同じ入力欄の値を出す', () => {
    const admin = createDateFormat(SITE.timeZone);
    // 日付をまたぐ側と、またがない側の両方を見る。
    for (const iso of ['2026-08-01T00:00:00.000Z', '2026-08-19T23:00:00.000Z']) {
      const date = new Date(iso);
      expect(admin.isoDate(date), iso).toBe(isoDate(date));
      expect(admin.toDateTimeInput(date), iso).toBe(toDateTimeInput(date));
      expect(admin.fromDateTimeInput(toDateTimeInput(date)), iso).toBe(iso);
    }
  });
});
