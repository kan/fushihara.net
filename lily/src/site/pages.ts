/**
 * 各ページの中身。外枠は `layout.ts`。
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

/**
 * `html` は値に Promise が混ざると Promise を返す。組み立ての途中では
 * どちらもありうるので、この別名で受けて最後に `layout` が await する。
 */
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
import { displayDate, isoDate } from '../../../shared/date.ts';
import type { PageContext, PostSummaryView, PostView, TagView } from '../core/theme.ts';
import { layout } from './layout.ts';

/**
 * 日付。**`label` は `<time>` の外に置く。** 中に入れると `datetime` 属性と
 * 食い違ううえ、テキストでの突き合わせも壊れる。
 */
function postDate(date: Date, label?: string): Html {
  return html`<span class="post-date"
    >${label}<time datetime="${isoDate(date)}">${displayDate(date)}</time></span
  >`;
}

/**
 * 「更新」を出すか。**表示が日付までなので、比較も日付で行う。**
 * 素の時刻で比べると、作成と公開が別クエリなぶん数 ms ずれるだけで
 * 出したての記事に「更新」が付く。
 */
function isUpdated(publishedAt: Date, updatedAt: Date): boolean {
  return isoDate(updatedAt) > isoDate(publishedAt);
}

function tagChips(tags: readonly TagView[]): Html[] {
  return tags.map((tag) => html`<a class="tag" href="${tag.url}">${tag.name}</a>`);
}

function postMeta(post: PostSummaryView, options: { updated?: boolean } = {}): Html {
  return html`<div class="post-meta">
    ${post.publishedAt ? postDate(post.publishedAt) : ''}
    ${options.updated && post.publishedAt && isUpdated(post.publishedAt, post.updatedAt)
      ? postDate(post.updatedAt, '更新 ')
      : ''}
    ${tagChips(post.tags)} ${post.isDraft ? html`<span class="tag">draft</span>` : ''}
  </div>`;
}

function postList(posts: readonly PostSummaryView[]): Html {
  return html`<ul class="post-list">
    ${posts.map(
      (post) => html`<li>
        ${postMeta(post)}
        <h2><a href="${post.url}">${post.title}</a></h2>
        ${post.description ? html`<p class="post-summary">${post.description}</p>` : ''}
      </li>`,
    )}
  </ul>`;
}

export function indexPage(
  context: PageContext,
  posts: readonly PostSummaryView[],
): Promise<string> {
  return layout(
    context,
    { brandIsHeading: true },
    html`${posts.length === 0 ? html`<p class="post-summary">まだ記事がありません。</p>` : ''}
    ${postList(posts)}`,
  );
}

export function postPage(context: PageContext, post: PostView): Promise<string> {
  return layout(
    context,
    { page: post.title, description: post.description ?? undefined, ogType: 'article' },
    html`<article>
      ${postMeta(post, { updated: true })}
      <h1 class="post-title">${post.title}</h1>
      <!-- 本文は描画済みの HTML。placeholder は配信 URL に解決済み。 -->
      <div class="prose">${raw(post.html)}</div>
    </article>`,
  );
}

export function tagPage(
  context: PageContext,
  tag: TagView,
  posts: readonly PostSummaryView[],
): Promise<string> {
  return layout(
    context,
    { page: `${tag.name} の記事` },
    html`<h1 class="post-title">${tag.name}</h1>
      ${posts.length === 0
        ? html`<p class="post-summary">このタグの記事はまだありません。</p>`
        : postList(posts)}`,
  );
}

export function notFoundPage(context: PageContext): Promise<string> {
  return layout(
    context,
    { page: '404' },
    html`<h1>404</h1>
      <p class="post-summary">そのページはありません。</p>
      <p><a href="${context.urls.index()}">記事一覧へ</a></p>`,
  );
}
