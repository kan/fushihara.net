import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/core/render/index.ts';

const MEDIA = [{ public_id: 'MEDIA-ID', filename: 'sample.png' }];

async function html(markdown: string, media = MEDIA): Promise<string> {
  return (await renderMarkdown(markdown, { media })).html;
}

describe('CommonMark + GFM', () => {
  it('見出し・リスト・引用・強調が出る', async () => {
    const out = await html(
      ['## 見出し 2', '', '- 箇条書き', '', '> 引用', '', '**強い**と*斜め*'].join('\n'),
    );
    expect(out).toContain('<h2>見出し 2</h2>');
    expect(out).toContain('<li>箇条書き</li>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<strong>強い</strong>');
    expect(out).toContain('<em>斜め</em>');
  });

  it('GFM の表・取り消し線・タスクリストが出る', async () => {
    const out = await html(
      ['| 表 | も |', '|---|---|', '| 使 | える |', '', '~~消し~~', '', '- [x] done'].join('\n'),
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<del>消し</del>');
    expect(out).toContain('<input type="checkbox" checked disabled>');
  });

  it('表が壊れない (rehype-raw を使うと表の外へ空行が漏れる)', async () => {
    const out = await html(['```', 'x', '```', '', '| a |', '|---|', '| b |'].join('\n'));
    // </pre> と <table> の間に空行が並んでいたら、HTML を parse5 で読み直している
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe('コードハイライト', () => {
  it('色は CSS 変数で出す (defaultColor: false を維持する)', async () => {
    const out = await html(['```ts', 'export const a = 1;', '```'].join('\n'));
    expect(out).toContain('--shiki-light:');
    expect(out).toContain('--shiki-dark:');
    // 色を直接書かれると blog.css の light-dark() を殴るので !important が要る
    expect(out).not.toMatch(/style="[^"]*[^-]color:/);
  });

  it('言語指定なしのフェンスも Shiki を通る (スタイルが当たるように)', async () => {
    const out = await html(['```', 'ただの文字', '```'].join('\n'));
    expect(out).toContain('class="shiki');
  });

  it('載せていない言語でも落ちない', async () => {
    const out = await html(['```brainfuck', '+++.', '```'].join('\n'));
    expect(out).toContain('class="shiki');
    expect(out).toContain('+++.');
  });

  it('折り返しは CSS に任せる (保存する HTML に見せ方を焼き込まない)', async () => {
    const out = await html(['```ts', 'const a = 1;', '```'].join('\n'));
    expect(out).not.toContain('white-space');
  });
});

describe('本文に書いた HTML', () => {
  it('コードブロックと inline code は書き換えられずそのまま出る', async () => {
    const out = await html(
      ['インラインの `<img src="./sample.png">` と:', '', '```', '<img src="./sample.png">', '```'].join('\n'),
    );
    // text ノードなので `<` はエスケープされるが、中身は素のまま残る
    expect(out).toContain('&#x3C;img src="./sample.png">');
    expect(out.match(/lily-media:/g)).toBeNull();
  });

  it('生 HTML はパースし直さずそのまま運ぶ', async () => {
    const out = await html('<div class="note" data-x="1">本文</div>');
    expect(out).toContain('<div class="note" data-x="1">本文</div>');
  });
});

describe('相対参照の解決', () => {
  it('Markdown の画像記法を placeholder にする', async () => {
    expect(await html('![図](./sample.png)')).toContain(
      '<img src="lily-media://MEDIA-ID/sample.png" alt="図">',
    );
  });

  it('./ 無しでも突き合わせる', async () => {
    expect(await html('![図](sample.png)')).toContain('lily-media://MEDIA-ID/sample.png');
  });

  it('生 HTML で書いた相対参照も同じ規則で解決する', async () => {
    const out = await html('<img src="./sample.png" width="300">');
    expect(out).toContain('<img src="lily-media://MEDIA-ID/sample.png" width="300">');
  });

  it('生 HTML の属性は大小文字とクォートの形を選ばない', async () => {
    // ここが狭いと未解決のまま配信物に残り、しかも onUnresolved にも出ないので
    // 警告にすら現れない (相対 URL のまま公開ページに出て 404 になる)。
    //
    // 引用符なしで `src=./sample.png` と書いた場合は micromark が生 HTML と
    // 見なさず、エスケープされたテキストとして出る (実測)。そもそも raw ノードに
    // ならないので、ここでは引用符なしは `sample.png` の形で見ている。
    const forms = [
      'src="./sample.png"',
      "src='./sample.png'",
      'SRC="./sample.png"',
      'src = "./sample.png"',
      'src=sample.png',
    ];

    for (const attribute of forms) {
      const out = await html(`<img ${attribute}>`);
      // 書き換えたぶんは必ず二重引用符で囲み直す (属性名の大小はそのまま残す)
      expect(out, attribute).toMatch(/<img src="lily-media:\/\/MEDIA-ID\/sample\.png">/i);
    }
  });

  it('リンクの href も解決する', async () => {
    expect(await html('[図](./sample.png)')).toContain('href="lily-media://MEDIA-ID/sample.png"');
  });

  it('別ディレクトリ・外部 URL・アンカーには触らない', async () => {
    const out = await html(
      [
        '[a](../../CONTRACT.md)',
        '[b](https://example.com/sample.png)',
        '[c](#anchor)',
        '[d](mailto:a@example.com)',
      ].join('\n\n'),
    );
    expect(out).toContain('href="../../CONTRACT.md"');
    expect(out).toContain('href="https://example.com/sample.png"');
    expect(out).toContain('href="#anchor"');
    expect(out).toContain('href="mailto:a@example.com"');
  });

  it('解決できない ./ の参照は元のまま残し、警告として返す', async () => {
    const result = await renderMarkdown('![無い](./missing.png)', { media: MEDIA });
    expect(result.html).toContain('src="./missing.png"');
    expect(result.unresolvedMedia).toEqual(['./missing.png']);
  });

  it('同じ参照が何度出ても警告は 1 回', async () => {
    const result = await renderMarkdown('![a](./missing.png) と ![b](./missing.png)', { media: MEDIA });
    expect(result.unresolvedMedia).toEqual(['./missing.png']);
  });

  it('./ 無しの記事間リンクは警告しない', async () => {
    const result = await renderMarkdown('[他の記事](other.md)', { media: MEDIA });
    expect(result.unresolvedMedia).toEqual([]);
  });

  it('スキームに見える値はスキームとして扱う (同名の添付があっても)', async () => {
    // `media.filename` は `:` を含められるので `mailto:x.png` という添付は作れる。
    // そのとき `[a](mailto:x.png)` をどちらに解釈するかは決めておく必要がある。
    const media = [{ public_id: 'X', filename: 'mailto:x.png' }];
    expect(await html('[a](mailto:x.png)', media)).toContain('href="mailto:x.png"');
  });

  it('percent encoding された名前も突き合わせる', async () => {
    const media = [{ public_id: 'JP', filename: '日本語.png' }];
    const out = await html('![図](./%E6%97%A5%E6%9C%AC%E8%AA%9E.png)', media);
    expect(out).toContain('lily-media://JP/%E6%97%A5%E6%9C%AC%E8%AA%9E.png');
  });
});
