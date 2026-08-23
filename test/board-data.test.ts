import { describe, expect, it } from 'vitest';
import { boardData } from '../src/board-data';
import { mobileOrder } from '../src/layout';

const noteIds = boardData.notes.map((n) => n.id);

describe('ノート定義', () => {
  it('id が重複していない', () => {
    expect(new Set(noteIds).size).toBe(noteIds.length);
  });

  it('全ノートが正の幅と高さを持つ', () => {
    for (const note of boardData.notes) {
      expect(note.width, note.id).toBeGreaterThan(0);
      expect(note.height, note.id).toBeGreaterThan(0);
    }
  });
});

describe('エッジ定義', () => {
  it('id が重複していない', () => {
    const ids = boardData.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('from / to が実在するノートを指している', () => {
    for (const edge of boardData.edges) {
      expect(noteIds, `${edge.id}.from`).toContain(edge.from);
      expect(noteIds, `${edge.id}.to`).toContain(edge.to);
    }
  });

  it('自己ループがない', () => {
    for (const edge of boardData.edges) {
      expect(edge.from, edge.id).not.toBe(edge.to);
    }
  });
});

describe('mobileOrder', () => {
  // 768px 未満のレイアウトは mobileOrder だけを見て組む。ここから漏れたノートは
  // モバイルで画面外に取り残されるため、追加漏れを検知する。
  it('全ノートが含まれている', () => {
    expect([...mobileOrder].sort()).toEqual([...noteIds].sort());
  });

  it('存在しないノート id を含まない', () => {
    for (const id of mobileOrder) {
      expect(noteIds, id).toContain(id);
    }
  });

  it('重複がない', () => {
    expect(new Set(mobileOrder).size).toBe(mobileOrder.length);
  });
});
