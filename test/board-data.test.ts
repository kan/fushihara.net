import { describe, expect, it } from 'vitest';
import { boardData, EXTRA_SKILLS, OSS_REPOS } from '../src/board-data';
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

describe('OSS_REPOS', () => {
  // 静的テキストと main.ts の補完の両方がこの並びを使う
  it('空でなく、重複もない', () => {
    expect(OSS_REPOS.length).toBeGreaterThan(0);
    expect(new Set(OSS_REPOS).size).toBe(OSS_REPOS.length);
  });

  it('静的テキストにも全部載っている（API が落ちても消えない）', () => {
    const oss = boardData.notes.find((n) => n.id === 'oss')!;
    for (const name of OSS_REPOS) expect(oss.text).toContain(name);
  });
});

/**
 * **中身がアイコンだけなので、壊れても画面に出ない。** リンク先が違っていても、
 * 新しいタブで開かなくなっていても、絵は同じように並ぶ。
 */
describe('Powered by', () => {
  const text = boardData.notes.find((n) => n.id === 'poweredby')!.text;
  const links = [...text.matchAll(/<a\s+href="([^"]+)"([^>]*)>/g)];

  it('どのリンクも https で、新しいタブで開く', () => {
    expect(links.length).toBeGreaterThan(0);
    for (const [, href, attrs] of links) {
      expect(href, href).toMatch(/^https:\/\//);
      expect(attrs, href).toContain('target="_blank"');
    }
  });

  // 自作の 2 つは npm を指す。**ここは「何で動いているか」の一覧**なので、
  // リポジトリより「入れて使えるもの」を指す（wema に揃えた）。
  it('自作パッケージは npm を指す', () => {
    for (const pkg of ['@kanf/wema', '@kanf/lily']) {
      expect(text).toContain(`https://www.npmjs.com/package/${pkg}`);
    }
  });

  // **リンクの数だけアイコンがあること。** 片方だけ足すと、絵の無いリンクか
  // どこにも行かない絵ができる。**SVG として読めるかはここでは見ない** ――
  // 壊れた XML は「img が出ない」形で現れるので、実際に描かせる E2E の領分
  // （`e2e/render.spec.ts` の「Powered by のアイコンが全部デコードできる」）。
  it('リンクと同じ数のアイコンがある', () => {
    const uris = [...text.matchAll(/src="data:image\/svg\+xml,([^"]+)"/g)];
    expect(uris.length).toBe(links.length);
    for (const [, encoded] of uris) {
      const svg = decodeURIComponent(encoded);
      expect(svg.startsWith('<svg'), svg.slice(0, 40)).toBe(true);
      expect(svg.endsWith('</svg>'), svg.slice(-40)).toBe(true);
    }
  });
});

describe('EXTRA_SKILLS', () => {
  it('空でなく、重複もない', () => {
    expect(EXTRA_SKILLS.length).toBeGreaterThan(0);
    expect(new Set(EXTRA_SKILLS).size).toBe(EXTRA_SKILLS.length);
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
