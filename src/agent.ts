/**
 * AI エージェント向けに配るもの（Markdown 版、JSON-LD、robots.txt、sitemap.xml）。
 * 経緯は issue #58。
 *
 * **本体は JS が無いと本文が読めない。** `index.html` には `#app` しかなく、付箋は
 * wema が描く。HTML を Markdown へ変換する方式（Cloudflare の Markdown for Agents
 * など）では中身が空になるので、**付箋のデータ（`board-data.ts`）から組む。**
 * 付箋と別に文章を書くと、片方だけ古くなる。
 *
 * DOM に触れない。Worker（`worker/pages.ts`）と `vite.config.ts`（JSON-LD）と
 * テストが読む。
 */
import type { WemaBoardData } from '@kanf/wema';
// 拡張子付きで読む（`vite.config.ts` からも読まれるため。理由はあちらの冒頭）
import { boardData, LOADING } from './board-data.ts';
import { mobileOrder } from './layout.ts';
import { unescapeHtml } from './note-html.ts';
import { OWNER_NAME, OWNER_URL, SITE_ORIGIN, SOCIAL_URLS } from '../shared/profile.ts';

/**
 * ページの名前と説明。**`index.html` の `<title>` / `og:title` / `og:description` も
 * ここから出る**（`vite.config.ts` の `siteMeta()` が `%SITE_TITLE%` などを置き換える）。
 * Markdown 版の frontmatter と HTML で同じ文字列を 2 回書かないため。
 */
export const SITE_TITLE = 'KAN Fushihara - Portfolio';
export const SITE_DESCRIPTION = 'KAN Fushihara のポートフォリオサイト';

/** ブログ（別 Worker）の、本体から指す口。`blog/CONTRACT.md` の URL 表にあるもの */
export const BLOG_PATHS = {
  index: '/blog/',
  sitemap: '/blog/sitemap-index.xml',
  feed: '/blog/rss.xml',
  admin: '/blog/admin/',
  api: '/blog/api/',
} as const;

/** 本体のサイトマップ（`worker/pages.ts` が配る） */
export const SITEMAP_PATH = '/sitemap.xml';

type Part = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };
type Note = { heading: string; lines: Part[][] };

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeHtml(m[1]) : null;
}

/**
 * 付箋の `text`（HTML）を、見出しと行に分ける。
 *
 * **相手は自分で書いた付箋だけ**なので、汎用の HTML パーサは持たない。出てくる
 * タグは `b` / `br` / `div` / `span` / `a` / `img` で、`br` と `div` の境目を行に、
 * `a` をリンクに、`img` の `alt` をリンクの文字にする（アイコンのリンクには文字が
 * 無い）。最初の `<b>` が見出しになる。
 */
export function parseNote(html: string): Note {
  const lines: Part[][] = [[]];
  let heading: string | null = null;
  let inHeading = false;
  let link: { href: string; text: string } | null = null;

  const newline = () => {
    if (lines[lines.length - 1].length > 0) lines.push([]);
  };

  // コメントは読み飛ばす。タグ名は大文字も受ける（`<br/>` も `<BR>` も同じ）。
  // タグにならない `<` は文字として扱う
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+|<)/g;
  for (let m = tokens.exec(html); m !== null; m = tokens.exec(html)) {
    const [, closing, rawTag, attrs = '', raw] = m;
    if (rawTag === undefined && raw === undefined) continue;
    const tag = rawTag?.toLowerCase();
    if (raw !== undefined) {
      const text = unescapeHtml(raw);
      if (inHeading) heading = (heading ?? '') + text;
      else if (link) link.text += text;
      else lines[lines.length - 1].push({ type: 'text', text });
      continue;
    }
    if (tag === 'b' && heading === null && !closing) inHeading = true;
    else if (tag === 'b' && inHeading && closing) inHeading = false;
    else if (tag === 'br' || tag === 'div') newline();
    else if (tag === 'a' && !closing) link = { href: attr(attrs, 'href') ?? '', text: '' };
    else if (tag === 'a' && closing && link) {
      lines[lines.length - 1].push({ type: 'link', ...link });
      link = null;
    } else if (tag === 'img' && link) link.text += attr(attrs, 'alt') ?? '';
  }

  const kept = lines
    .map((parts) => parts.filter((p) => p.type === 'link' || p.text.trim() !== ''))
    .filter((parts) => parts.length > 0)
    // 動的データが入るまでの仮の文字（`board-data.ts` の `LOADING`）は出さない。
    // API の結果はブラウザで付箋を書き換えるだけで、ここには来ない
    .filter((parts) => !(parts.length === 1 && parts[0].type === 'text' && parts[0].text.trim() === LOADING));
  return { heading: (heading ?? '').trim(), lines: kept };
}

/** Markdown で意味を持つ記号を逃がす。付箋の文言はほぼ素の文字だが、念のため */
function escapeMd(s: string): string {
  return s.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

function absolute(href: string): string {
  return href.startsWith('/') ? `${SITE_ORIGIN}${href}` : href;
}

function mdLink(text: string, href: string): string {
  const url = absolute(href);
  // 空白や括弧を含む URL は `<…>` で包む（CommonMark のリンク先の書き方）
  const dest = /[\s()]/.test(url) ? `<${url}>` : url;
  return `[${escapeMd(text.trim())}](${dest})`;
}

/**
 * 行頭で見出しや箇条書きに読まれる形（`#` / `- ` / `+ ` / `1. `）を逃がす。
 * 付箋の 1 行が、Markdown の構造を勝手に作らないように。
 */
function escapeLineStart(line: string): string {
  return line
    .replace(/^#/, '\\#')
    .replace(/^([-+])(\s)/, '\\$1$2')
    .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
}

function renderLine(parts: Part[]): string {
  return escapeLineStart(
    parts
      .map((p) => (p.type === 'link' ? mdLink(p.text, p.href) : escapeMd(p.text)))
      .join('')
      .trim(),
  );
}

const isLinkOnly = (parts: Part[]) => parts.every((p) => p.type === 'link');

/**
 * 1 枚の付箋を Markdown の節にする。
 *
 * **リンクだけの行は、付箋の中に 2 つ以上あれば箇条書きにする。** Social のアイコンや
 * OSS の行は、並びそのものが中身なので。中央の付箋の勤め先のように 1 つしか無い
 * リンクは、段落のまま残す。
 */
function renderNote(note: Note, level: 1 | 2): string {
  const linkCount = note.lines.filter(isLinkOnly).reduce((n, parts) => n + parts.length, 0);
  const blocks: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length > 0) blocks.push(list.join('\n'));
    list = [];
  };
  for (const parts of note.lines) {
    if (linkCount >= 2 && isLinkOnly(parts)) {
      for (const p of parts) if (p.type === 'link') list.push(`- ${mdLink(p.text, p.href)}`);
    } else {
      flush();
      blocks.push(renderLine(parts));
    }
  }
  flush();
  return [`${'#'.repeat(level)} ${escapeMd(note.heading)}`, ...blocks].join('\n\n');
}

/** YAML の値。文字列はすべて二重引用符で包む（`:` や `#` を含んでも読めるように） */
const yaml = (s: string) => JSON.stringify(s);

/**
 * トップページの Markdown 版。**付箋の並びは縦積みのとき（`mobileOrder`）と同じ。**
 * 読む順として、すでに決めてあるため。先頭（中央の付箋）が `#`、ほかが `##`。
 *
 * 先頭の frontmatter はブログ（lily）の Markdown 版と同じ形にそろえてある。
 */
export function homeMarkdown(data: WemaBoardData = boardData): string {
  const notes = mobileOrder
    .map((id) => data.notes.find((n) => n.id === id))
    .filter((n) => n !== undefined)
    .map((n) => parseNote(n.text))
    // 中身が仮の文字だけの付箋（Skills）は節ごと出さない。見出しだけ並べると、
    // 何も無い節に見える
    .filter((note) => note.lines.length > 0);
  const body = notes.map((note, i) => renderNote(note, i === 0 ? 1 : 2)).join('\n\n');
  return [
    '---',
    `title: ${yaml(SITE_TITLE)}`,
    `description: ${yaml(SITE_DESCRIPTION)}`,
    `url: ${yaml(OWNER_URL)}`,
    'lang: "ja"',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** 404 の Markdown 版。**ステータスは 404 のまま返す**（`worker/pages.ts`） */
export function notFoundMarkdown(): string {
  return [
    '# Not Found',
    '',
    `- [${SITE_TITLE}](${SITE_ORIGIN}/)`,
    `- [Blog](${SITE_ORIGIN}${BLOG_PATHS.index})`,
    `- [Sitemap](${SITE_ORIGIN}${SITEMAP_PATH})`,
    '',
  ].join('\n');
}

/**
 * robots.txt。**ルートの 1 枚がブログ（`/blog/`）にも効く。** ブログ Worker の
 * `/blog/robots.txt` はクローラに読まれない。
 *
 * - AI のクローラも含めて全部許可する。学習（`ai-train`）も含めて許可するのは
 *   ユーザーの判断
 * - **AI のクローラは名指しのグループにも書く。** 自分の名前のグループがあると
 *   `*` のグループは読まれない（RFC 9309）ので、管理画面の `Disallow` も両方に要る
 * - Cloudflare の managed robots.txt を有効にしていると、Cloudflare がこの前に
 *   自分の行を足す
 */
const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
  'CCBot', 'Amazonbot', 'meta-externalagent',
];

export function robotsTxt(): string {
  const rules = [
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
    'Allow: /',
    // ブログの管理画面と管理 API。Cloudflare Access の内側なので、読めるものは無い
    `Disallow: ${BLOG_PATHS.admin}`,
    `Disallow: ${BLOG_PATHS.api}`,
  ];
  return [
    'User-agent: *',
    ...rules,
    '',
    ...AI_CRAWLERS.map((name) => `User-agent: ${name}`),
    ...rules,
    '',
    `Sitemap: ${SITE_ORIGIN}${SITEMAP_PATH}`,
    `Sitemap: ${SITE_ORIGIN}${BLOG_PATHS.sitemap}`,
    '',
  ].join('\n');
}

/**
 * 本体のサイトマップ。**ページは `/` の 1 枚だけ。** ブログの記事はブログの
 * サイトマップ（`BLOG_PATHS.sitemap`）が持ち、robots.txt が両方を指す。
 */
export function sitemapXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${SITE_ORIGIN}/</loc></url>`,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * トップページの JSON-LD（`WebSite` と `Person`）。`vite.config.ts` がビルド時に
 * `<head>` へ焼く。
 *
 * **`sameAs` は `shared/profile.ts` の `SOCIAL_URLS`。** `<link rel="me">` と、
 * ブログの JSON-LD の著者（lily の `site.sameAs`）も同じものを使う。
 */
export function homeJsonLd(): Record<string, unknown> {
  const person = `${OWNER_URL}#person`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${OWNER_URL}#website`,
        url: OWNER_URL,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        inLanguage: 'ja',
        author: { '@id': person },
      },
      {
        '@type': 'Person',
        '@id': person,
        name: OWNER_NAME,
        url: OWNER_URL,
        sameAs: SOCIAL_URLS,
      },
    ],
  };
}

/**
 * `<script type="application/ld+json">` の中身。**`<` を逃がす。** 値に
 * `</script>` が入っても要素を閉じられないように（JSON としては同じ文字に読める）。
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
