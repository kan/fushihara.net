import { describe, expect, it } from 'vitest';
import { boardData } from '../src/board-data';
import {
  MARGIN,
  MOBILE_TOP,
  MOBILE_BP,
  MOBILE_GAP,
  REF_H,
  REF_W,
  getTargetLayout,
  mobileOrder,
  noteBases,
} from '../src/layout';

const bases = noteBases(boardData);

describe('noteBases', () => {
  it('board-data の座標とサイズをそのまま取り込む', () => {
    const center = boardData.notes.find((n) => n.id === 'center')!;

    expect(bases.get('center')).toEqual({
      x: center.x,
      y: center.y,
      width: center.width,
      height: center.height,
    });
  });

  it('全ノート分を持つ', () => {
    expect(bases.size).toBe(boardData.notes.length);
  });
});

describe('デスクトップレイアウト', () => {
  it('リファレンスサイズちょうどなら元の座標のまま', () => {
    const layout = getTargetLayout(REF_W, REF_H, bases);
    const center = bases.get('center')!;

    expect(layout.get('center')).toEqual({ x: center.x, y: center.y, width: center.width });
  });

  it('ビューポートに比例して座標をスケールする', () => {
    const layout = getTargetLayout(REF_W * 2, REF_H * 2, bases);
    const base = bases.get('blog')!;

    expect(layout.get('blog')).toEqual({
      x: base.x * 2,
      y: base.y * 2,
      width: base.width,
    });
  });

  it('幅は元のまま変えない（スケールするのは座標だけ）', () => {
    const layout = getTargetLayout(REF_W * 2, REF_H * 2, bases);

    for (const [id, base] of bases) {
      expect(layout.get(id)!.width, id).toBe(base.width);
    }
  });

  it('poweredby だけは右下に固定する', () => {
    const vw = 1920;
    const vh = 1080;
    const layout = getTargetLayout(vw, vh, bases);
    const base = bases.get('poweredby')!;

    expect(layout.get('poweredby')).toEqual({
      x: vw - base.width - MARGIN,
      y: vh - base.height - MARGIN,
      width: base.width,
    });
  });

  /**
   * **背の高いノートは右下固定の `poweredby` に食い込む。**
   *
   * `getTargetLayout()` は y をビューポート高に合わせて詰めるが、**高さは
   * 縮めない**。だからノートを高くすると、そのぶん下へ伸びて `poweredby` に
   * 当たる。`oss` を 272 にしたときに 1280x720 で 2px 重なった。
   *
   * **E2E ではなくここで見張る。** あちらは 1400x900 固定で、たまたま踏んだ
   * 1 点を足しても他の高さの再発は拾えない。純粋関数なのでブラウザが要らず、
   * 総当たりしてもただ同然。
   *
   * 見るのは**宣言した高さ**なので、`OSS_REPOS` を増やしただけではここは
   * 落ちない（中身があふれるのは `e2e/render.spec.ts` の「付箋の中身が
   * はみ出さない」が見る）。**順番はこう** —— 件数を増やす → あちらが落ちる →
   * 高さを上げる → 上げすぎるとここが落ちる。
   *
   * **下限は 700px。** それ未満はこの検査の対象外で、実際に重なる ――
   * 高さを詰めても直らない（`oss` を押し上げると今度は上の `blog` に当たる。
   * vh=680 で余白 6px、660 で 0px、620 で既に -13px）。**ボードがそもそも
   * 入りきらない**ので、直すなら配置か高さの設計から変えることになる。
   */
  it('vh 700 以上では poweredby に他のノートが重ならない', () => {
    const pbBase = bases.get('poweredby')!;
    const hit: string[] = [];

    for (let vh = 700; vh <= 1400; vh += 10) {
      const layout = getTargetLayout(1280, vh, bases);
      const rect = (id: string) => {
        const l = layout.get(id)!;
        return { ...l, bottom: l.y + bases.get(id)!.height, right: l.x + l.width };
      };
      const pb = { ...rect('poweredby'), bottom: 0 };
      pb.bottom = layout.get('poweredby')!.y + pbBase.height;

      for (const id of bases.keys()) {
        if (id === 'poweredby') continue;
        const r = rect(id);
        const w = Math.min(r.right, pb.right) - Math.max(r.x, pb.x);
        const h = Math.min(r.bottom, pb.bottom) - Math.max(r.y, pb.y);
        if (w > 0 && h > 0) hit.push(`vh=${vh} ${id} ${Math.round(w)}x${Math.round(h)}`);
      }
    }

    expect(hit).toEqual([]);
  });

  it('全ノートが配置される', () => {
    const layout = getTargetLayout(REF_W, REF_H, bases);

    expect(layout.size).toBe(bases.size);
  });

  it('座標は整数に丸められる（サブピクセルのにじみを避ける）', () => {
    const layout = getTargetLayout(1337, 787, bases);

    for (const [id, l] of layout) {
      expect(Number.isInteger(l.x), `${id}.x`).toBe(true);
      expect(Number.isInteger(l.y), `${id}.y`).toBe(true);
    }
  });

  it('境界値 768px はデスクトップ扱い', () => {
    const layout = getTargetLayout(MOBILE_BP, 900, bases);

    // モバイルなら全ノートが同じ x になるので、そうでないことを確認する
    const xs = new Set([...layout.values()].map((l) => l.x));
    expect(xs.size).toBeGreaterThan(1);
  });
});

describe('モバイルレイアウト', () => {
  const vw = 390;
  const layout = getTargetLayout(vw, 844, bases);

  it('全ノートが左マージン揃いの 1 カラムになる', () => {
    expect(layout.size).toBe(bases.size);
    for (const [id, l] of layout) {
      expect(l.x, id).toBe(MARGIN);
      expect(l.width, id).toBe(vw - MARGIN * 2);
    }
  });

  it('mobileOrder の順に上から積まれる', () => {
    const ys = mobileOrder.map((id) => layout.get(id)!.y);

    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('前のノートの高さと MOBILE_GAP の分だけ間隔が空く', () => {
    for (let i = 1; i < mobileOrder.length; i++) {
      const prev = mobileOrder[i - 1];
      const curr = mobileOrder[i];
      const expected = layout.get(prev)!.y + bases.get(prev)!.height + MOBILE_GAP;

      expect(layout.get(curr)!.y, curr).toBe(expected);
    }
  });

  it('先頭は上マージンから始まる', () => {
    // 左上の見出しに重ならないよう、1 枚目だけ下げる
    expect(layout.get(mobileOrder[0])!.y).toBe(MOBILE_TOP);
  });

  it('境界値 767px はモバイル扱い', () => {
    const narrow = getTargetLayout(MOBILE_BP - 1, 900, bases);

    for (const l of narrow.values()) {
      expect(l.x).toBe(MARGIN);
    }
  });
});
