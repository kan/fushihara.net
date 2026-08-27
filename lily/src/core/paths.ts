/**
 * mountPath と URL 生成。**URL を組む場所はここだけ。**
 *
 * `https://fushihara.net/blog/` と `https://blog.example.com/` (root mount) の
 * 両方を同じコアで扱うので、core に '/blog' を焼き付けない。文字列連結を
 * 各所に散らさないぶん、root mount の検証はユニットテストで済む。
 */
import { err, ok, type Result } from './result.ts';
import { isReservedSegment } from './routes/fixed.ts';

/** パス全体の長さ上限。export 先のファイルシステムに書ける範囲に収める。 */
const MAX_PATH_LENGTH = 200;
/** 1 セグメントの長さ上限。 */
const MAX_SEGMENT_LENGTH = 80;

/** Windows の予約デバイス名。`CON.txt` のように拡張子が付いても予約される。 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** ファイル名にも URL にも使えない文字。`/` はセグメント区切りとして別に扱う。 */
const FORBIDDEN_CHARS = /[\\<>:"|?*]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type PathErrorCode =
  | 'empty'
  | 'malformed-percent-encoding'
  | 'percent-not-allowed'
  | 'control-character'
  | 'empty-segment'
  | 'dot-segment'
  | 'forbidden-character'
  | 'windows-reserved-name'
  | 'trailing-dot-or-space'
  | 'too-long'
  | 'segment-too-long'
  | 'reserved-path';

export type PathError = { readonly code: PathErrorCode; readonly segment?: string };

/**
 * 記事のパスを正規化する。**管理画面・API・import・export・予約パス判定は
 * すべてこれを通す。**
 *
 * `path` は公開 URL であると同時に portable export のディレクトリ名になるので、
 * ファイルシステムに書ける形であることまでここで決める。
 */
export function normalizePostPath(input: string): Result<string, PathError> {
  // percent encoding は保存しない。1 回だけデコードしてから検査し、その後も `%` が
  // 残っていたら拒否する (`%252F` のような二重エンコードで `/` を紛れ込ませる経路を塞ぐ)。
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return err({ code: 'malformed-percent-encoding' });
  }
  if (decoded.includes('%')) return err({ code: 'percent-not-allowed' });

  // export 先の macOS が NFD を返すので、往復で別物にならないよう NFC に寄せる。
  const nfc = decoded.normalize('NFC');
  if (CONTROL_CHARS.test(nfc)) return err({ code: 'control-character' });

  // 前後のスラッシュは入力ミスとして取り除く。連続スラッシュは黙って畳むと
  // 予測しにくいので、下の空セグメント検査で拒否する。
  const trimmed = nfc.replace(/^\//, '').replace(/\/$/, '');
  if (trimmed === '') return err({ code: 'empty' });
  if (trimmed.length > MAX_PATH_LENGTH) return err({ code: 'too-long' });

  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '') return err({ code: 'empty-segment' });
    if (segment === '.' || segment === '..') return err({ code: 'dot-segment', segment });
    if (segment.length > MAX_SEGMENT_LENGTH) return err({ code: 'segment-too-long', segment });
    if (FORBIDDEN_CHARS.test(segment)) return err({ code: 'forbidden-character', segment });
    // Windows は末尾のドットと空白を落とすので、往復で別物になる。
    if (/[.\s]$/.test(segment)) return err({ code: 'trailing-dot-or-space', segment });
    const base = segment.split('.')[0] ?? segment;
    if (WINDOWS_RESERVED.has(base.toUpperCase())) {
      return err({ code: 'windows-reserved-name', segment });
    }
  }

  // 予約判定は第 1 セグメントだけ。route が持っていくのはそこなので。
  const first = segments[0] as string;
  if (isReservedSegment(first)) return err({ code: 'reserved-path', segment: first });

  return ok(trimmed);
}

/**
 * mountPath を正規化する。root mount は空文字、それ以外は先頭スラッシュ付き・
 * 末尾スラッシュ無し (`'' | '/blog'`)。
 */
export function normalizeMountPath(input: string): string {
  const segments = input.split('/').filter((s) => s !== '');
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/** 保存されているパスは decode 済みなので、URL に組むときにセグメント単位でエンコードする。 */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export type UrlOptions = { readonly absolute?: boolean };

export type UrlsConfig = {
  /** サイトの絶対 URL (`https://fushihara.net`)。末尾スラッシュは無視する。 */
  readonly siteUrl: string;
  /** マウント位置。OSS の標準構成では `'/'`。 */
  readonly mountPath: string;
};

export type MediaRef = { readonly public_id: string; readonly filename: string };
export type TagRef = { readonly slug: string };
export type FeedKind = 'rss' | 'atom';

/**
 * URL 生成器。`createUrls()` の戻り値を持ち回して使う。
 *
 * 記事の URL は `post_paths` にしか無いので、引数は canonical path そのもの
 * (`PostRow` は自分のパスを知らない)。
 */
export interface Urls {
  readonly mountPath: string;
  index(options?: UrlOptions): string;
  post(canonicalPath: string, options?: UrlOptions): string;
  tag(tag: TagRef, options?: UrlOptions): string;
  media(media: MediaRef, options?: UrlOptions): string;
  feed(kind: FeedKind, options?: UrlOptions): string;
  preview(token: string, options?: UrlOptions): string;
  admin(sub?: string, options?: UrlOptions): string;
  postsJson(options?: UrlOptions): string;
  sitemap(options?: UrlOptions): string;
  /** mount root 直下に置く静的アセット (favicon 3 点と ogp.png)。 */
  asset(filename: string, options?: UrlOptions): string;
}

export function createUrls(config: UrlsConfig): Urls {
  const mountPath = normalizeMountPath(config.mountPath);
  const origin = config.siteUrl.replace(/\/+$/, '');

  const build = (relative: string, options?: UrlOptions): string => {
    const path = `${mountPath}${relative}`;
    return options?.absolute ? `${origin}${path}` : path;
  };

  return {
    mountPath,
    index: (o) => build('/', o),
    post: (canonicalPath, o) => build(`/${encodePath(canonicalPath)}/`, o),
    tag: (tag, o) => build(`/tags/${encodeURIComponent(tag.slug)}/`, o),
    media: (media, o) =>
      build(`/media/${encodeURIComponent(media.public_id)}/${encodeURIComponent(media.filename)}`, o),
    feed: (kind, o) => build(`/${kind}.xml`, o),
    preview: (token, o) => build(`/preview/${encodeURIComponent(token)}`, o),
    admin: (sub, o) => build(sub === undefined ? '/admin/' : `/admin/${sub}`, o),
    postsJson: (o) => build('/posts.json', o),
    sitemap: (o) => build('/sitemap-index.xml', o),
    asset: (filename, o) => build(`/${encodeURIComponent(filename)}`, o),
  };
}
