import { describe, expect, it } from 'vitest';
import { homeJsonLd, homeMarkdown, parseNote } from '../src/agent';
import { boardData, LOADING } from '../src/board-data';
import { mobileOrder } from '../src/layout';
import { SOCIAL_URLS } from '../shared/profile';

describe('トップページの Markdown 版', () => {
  const md = homeMarkdown();

  it('どのリンクにも文字がある（アイコンの alt を省いていない）', () => {
    // `[](https://…)` は、エージェントにはどこへのリンクか分からない
    expect(md).not.toMatch(/\[\s*\]\(/);
    for (const note of boardData.notes) {
      for (const parts of parseNote(note.text).lines) {
        for (const p of parts) {
          if (p.type === 'link') expect(p.text.trim(), `${note.id}: ${p.href}`).not.toBe('');
        }
      }
    }
  });

  it('仮の文字（Loading...）を出さない', () => {
    expect(md).not.toContain(LOADING);
  });

  it('付箋の見出しが縦積みと同じ順に並ぶ', () => {
    const headings = [...md.matchAll(/^#{1,2} (.+)$/gm)].map((m) => m[1]);
    const expected = mobileOrder
      .map((id) => boardData.notes.find((n) => n.id === id)!)
      .map((n) => parseNote(n.text))
      .filter((n) => n.lines.length > 0)
      .map((n) => n.heading);
    expect(headings).toEqual(expected);
    expect(headings[0]).toBe('KAN Fushihara');
  });

  it('Social のアカウントが全部載る', () => {
    for (const url of SOCIAL_URLS) expect(md).toContain(`(${url})`);
  });

  it('サイト内のリンクは絶対 URL にする', () => {
    expect(md).not.toMatch(/\]\(\//);
  });
});

describe('付箋の HTML の読み方', () => {
  it('コメントを読み飛ばし、大文字や自己終了のタグも受ける', () => {
    const note = parseNote('<B>見出し</B><!-- メモ --><BR/>本文<br>二行目');
    expect(note.heading).toBe('見出し');
    expect(note.lines.map((parts) => parts.map((p) => p.text).join(''))).toEqual(['本文', '二行目']);
  });

  it('行頭の記号が見出しや箇条書きにならない', () => {
    const md = homeMarkdown({
      version: 1,
      notes: [
        { id: 'center', x: 0, y: 0, width: 1, height: 1, text: '<b>T</b><br># a<br>- b<br>1. c' },
      ],
      edges: [],
    } as unknown as Parameters<typeof homeMarkdown>[0]);
    expect(md).toContain('\\# a');
    expect(md).toContain('\\- b');
    expect(md).toContain('1\\. c');
  });

  it('空白や括弧を含むリンク先は <…> で包む', () => {
    const md = homeMarkdown({
      version: 1,
      notes: [
        {
          id: 'center', x: 0, y: 0, width: 1, height: 1,
          text: '<b>T</b><br><a href="https://example.com/a_(b)">x</a>',
        },
      ],
      edges: [],
    } as unknown as Parameters<typeof homeMarkdown>[0]);
    expect(md).toContain('[x](<https://example.com/a_(b)>)');
  });
});

describe('トップページの JSON-LD', () => {
  it('Person の sameAs は rel="me" と同じ一覧', () => {
    const graph = homeJsonLd()['@graph'] as { '@type': string; sameAs?: string[] }[];
    const person = graph.find((n) => n['@type'] === 'Person');
    expect(person?.sameAs).toEqual(SOCIAL_URLS);
  });
});
