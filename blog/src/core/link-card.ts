/**
 * リンクカード。貼った URL を、題・説明・サムネの付いたブロックとして本文に入れる。
 *
 * **本文に入るのは生 HTML。** `CONTRACT.md` が本文を CommonMark + GFM に縛って
 * いるので、独自記法（`::card{}` のたぐい）は使えない。生 HTML は CommonMark の
 * 一部なので、よその生成器に持って行っても素通しになる。renderer 側も
 * `allowDangerousHtml` で raw ノードのまま運ぶだけなので、手を入れずに済む。
 *
 * **サムネは外部を直リンクせず、その記事の添付として取り込む。**
 *
 *   - `rehypeMedia` は生 HTML の開始タグも見るので、`./card-….png` は他の画像と
 *     同じ経路（placeholder → 配信 URL → フィードの絶対 URL）に乗る
 *   - export の zip にそのまま入る（本文からは相対参照、という契約を満たす）
 *   - 相手が絵を差し替えても消しても、記事の見た目が変わらない
 *
 * 外へ取りに行くのは `link-preview.ts` の `fetchExternal()` 経由。**この 1 本に
 * 揃えてある**ので、SSRF の関門が片方だけ緩い、ということが起きない。
 */
import { html } from 'hono/html';
import { createMedia, findByPostAndFilename, mediaR2Key } from './db/media.ts';
import { uniqueViolationTarget } from './db/errors.ts';
import type { MediaRow, PostRow } from './db/types.ts';
import { toHex } from './ids.ts';
import { fetchExternal, fetchLinkPreview } from './link-preview.ts';
import { imageDimensions } from './media/dimensions.ts';
import { extensionForMime } from './media/formats.ts';
import { err, ok, type Result } from './result.ts';

/**
 * サムネに受け入れる大きさ。**アップロードの上限（20MB）より小さくしてある。**
 * OGP の絵は 1200x630 が定番で、まともなサイトなら 1MB に収まる。桁が違うものは
 * 罠か、そもそもカードに使えない絵。
 */
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

const IMAGE_ACCEPT = 'image/*';

/** カードの説明。長い説明を丸ごと入れると本文の Markdown が読めなくなる。 */
const MAX_DESCRIPTION = 140;

export type LinkCardText = {
  readonly url: string;
  readonly title: string;
  readonly description: string | null;
  /** 出典として出す文字。既定は host。 */
  readonly siteName: string;
  /** 取り込めた添付のファイル名と実寸。取れなければ null（画像なしのカード）。 */
  readonly thumbnail: {
    readonly filename: string;
    readonly width: number | null;
    readonly height: number | null;
  } | null;
};

/**
 * 本文に入れる HTML。
 *
 * - **空行を入れない。** CommonMark の HTML ブロック（type 7）は空行で終わる
 * - `<a>` の中は `<span>` だけ（`<div>` を入れると不正な HTML になる）
 * - `width` / `height` は自分で書く。`describeImage()` が寸法を足すのは Markdown の
 *   画像記法から出た `<img>` だけで、生 HTML には効かない（`render/media.ts`）
 * - フィードにはこのブログの CSS が無い。**素のままでも上から絵・題・説明・出典と
 *   読める順**にしておく
 */
export function linkCardHtml(card: LinkCardText): string {
  const thumbnail = card.thumbnail;
  const size =
    thumbnail?.width != null && thumbnail.height != null
      ? html` width="${thumbnail.width}" height="${thumbnail.height}"`
      : '';

  const image =
    thumbnail === null
      ? ''
      : html`\n  <img class="link-card-thumb" src="./${thumbnail.filename}" alt=""${size} loading="lazy" decoding="async">`;

  const description =
    card.description === null
      ? ''
      : html`\n    <span class="link-card-desc">${card.description}</span>`;

  return String(
    html`<a class="link-card" href="${card.url}">${image}
  <span class="link-card-text">
    <span class="link-card-title">${card.title}</span>${description}
    <span class="link-card-site">${card.siteName}</span>
  </span>
</a>`,
  );
}

export type LinkCardResult = {
  readonly html: string;
  /** 取り込んだサムネ。既にあったものを使い回したときも入る。無ければ null。 */
  readonly media: MediaRow | null;
};

export type LinkCardDeps = {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  /** 相手に名乗る User-Agent（`linkUserAgent()`）。 */
  readonly userAgent: string;
};

/**
 * URL からカードを組む。**相手から画像を取れなくてもカードは作る**（取れない日は
 * 珍しくない）。
 *
 * 題がまったく取れないときだけ失敗させる。host だけのカードは読み手に何も伝えず、
 * 管理画面としては「テキストリンクのままにする」方が正しいため。
 *
 * **D1 と R2 の失敗はここで握らない**（`Result` にするのは「起こりうる正常系」だけ、
 * という `result.ts` の線引き）。取り込みの途中で落ちたら 500 で出す。
 */
export async function buildLinkCard(
  deps: LinkCardDeps,
  post: PostRow,
  rawUrl: string,
): Promise<Result<LinkCardResult, 'link-unreachable'>> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return err('link-unreachable');
  }

  const preview = await fetchLinkPreview(url.href, deps.userAgent);
  if (preview.title === null) return err('link-unreachable');

  const media = preview.image === null ? null : await storeThumbnail(deps, post, url, preview.image);

  return ok({
    html: linkCardHtml({
      url: url.href,
      title: preview.title,
      description: trim(preview.description),
      siteName: preview.siteName ?? url.hostname,
      thumbnail:
        media === null
          ? null
          : { filename: media.filename, width: media.width, height: media.height },
    }),
    media,
  });
}

function trim(description: string | null): string | null {
  if (description === null) return null;
  const [...characters] = description;
  if (characters.length <= MAX_DESCRIPTION) return description;
  return `${characters.slice(0, MAX_DESCRIPTION).join('')}…`;
}

/**
 * OG 画像を取ってきて、その記事の添付にする。取れなければ null。
 *
 * **ファイル名はページの URL から決まる。** 同じリンクを貼り直しても添付が増えず、
 * 既にあるものを使い回せる（相手が絵を差し替えても、記事の中の絵は変わらない）。
 */
async function storeThumbnail(
  deps: LinkCardDeps,
  post: PostRow,
  pageUrl: URL,
  imageUrl: string,
): Promise<MediaRow | null> {
  const fetched = await fetchExternal(imageUrl, IMAGE_ACCEPT, deps.userAgent);
  if (fetched === null) return null;

  // **形式は相手の Content-Type で決める。** よそから来た画像にファイル名は無く、
  // URL の末尾も当てにならない（クエリで形式を変える CDN がある）。
  //
  // **小文字に寄せてから持ち回る。** ヘッダは大小を区別しないので `IMAGE/PNG` が
  // 来る。そのまま保存すると `imageDimensions` も `canBeOgp` も表に無い値として
  // 外し、export → import で拡張子から引き直された値と食い違う。
  const mime = (fetched.response.headers.get('Content-Type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
  const extension = extensionForMime(mime);
  if (extension === undefined) return null;

  // **中身を読む前に既存を見る。** ファイル名はページの URL と Content-Type から
  // 決まるので、本文を読まなくても分かる。2 回目のカード化で、最大 4MB の読み込みと
  // D1・R2 への書き込みを丸ごと省ける。
  const filename = `${thumbnailStem(pageUrl)}-${await shortHash(pageUrl.href)}.${extension}`;

  const existing = await findByPostAndFilename(deps.db, post.id, filename);
  if (existing) {
    // 読まずに捨てるときは明示的に畳む（開いたままのストリームを残さない）。
    await fetched.response.body?.cancel().catch(() => {});
    return existing;
  }

  const data = await readCapped(fetched.response, MAX_THUMBNAIL_BYTES);
  if (data === null || data.byteLength === 0) return null;

  const size = imageDimensions(data, mime);
  const r2Key = mediaR2Key(post.public_id, filename);

  let media: MediaRow;
  try {
    // **DB を先に入れてから R2 に置く。** アップロードと同じ順序（逆にすると、
    // 名前が衝突したときに既存の実体を上書きしてから失敗を返すことになる）。
    media = await createMedia(deps.db, {
      postId: post.id,
      filename,
      r2Key,
      mime,
      bytes: data.byteLength,
      width: size?.width,
      height: size?.height,
    });
  } catch (error) {
    // 同じカードを 2 回続けて押されたときだけ。既にあるものを使う。
    if (uniqueViolationTarget(error) === null) throw error;
    return await findByPostAndFilename(deps.db, post.id, filename);
  }

  await deps.bucket.put(r2Key, data, { httpMetadata: { contentType: mime } });
  return media;
}

/**
 * `card-<host>`。**組み立てる時点で `normalizeSegment` が通す形に収める。**
 *
 * 相手の host をそのまま使うと、`xn--` や大文字、`:` 付きが混ざる。export で
 * ディレクトリに書き出す名前なので、ここで書ける文字だけに落としておく。
 */
function thumbnailStem(pageUrl: URL): string {
  const host = pageUrl.hostname
    .replace(/^www\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return `card-${host === '' ? 'link' : host}`;
}

/** ページの URL から決まる 8 桁。同じ記事に同じリンクを貼っても 1 つで済む。 */
async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest).slice(0, 4));
}

/**
 * 上限まで読む。**超えたら諦めて null。**
 *
 * `arrayBuffer()` に任せると、相手が申告と違う大きさを流してきたときに、全部
 * 受け取ってから捨てることになる。
 */
async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) return null;
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }

  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}
