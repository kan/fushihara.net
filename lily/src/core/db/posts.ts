/**
 * 記事の読み書き。**SQL を route や service に書かない。**
 *
 * 並び順は `published_at DESC`、同一時刻のときは `public_id ASC` を stable
 * tie-breaker にする。内部 id ではなく public_id なのは、export / import で
 * integer が振り直されても並びが変わらないようにするため。
 */
import { newPublicId, nowIso } from '../ids.ts';
import { normalizePostPath } from '../paths.ts';
import { err, ok, type Result } from '../result.ts';
import { uniqueViolationTarget } from './errors.ts';
import { listR2KeysByPost } from './media.ts';
import { findByPathCi, initialPathStatements, isPathTakenViolation, type PathWriteError } from './post-paths.ts';
import {
  postColumns,
  type PostRow,
  type PostStatus,
  type PostWithPathRow,
} from './types.ts';

/** 一覧・フィード共通の並び。 */
const PUBLISHED_ORDER = 'p.published_at DESC, p.public_id ASC';

/**
 * 「公開記事とは何か」。並び順と同じくここを正にする (`tags.ts` の件数集計も読む)。
 * 条件を変える日に 1 箇所で済み、タグの件数だけ古い条件のまま残ることがない。
 */
export function PUBLISHED_WHERE(alias: string): string {
  return `${alias}.status = 'published'`;
}

/** posts の UNIQUE 制約。identity の衝突とパスの衝突を取り違えないため。 */
const PUBLIC_ID_UNIQUE_TARGET = 'posts.public_id';

export type CreatePostInput = {
  title: string;
  bodyMd: string;
  description?: string | null;
  status?: PostStatus;
  /** UTC ISO8601。`published` で省略したときは現在時刻。 */
  publishedAt?: string | null;
  /** 省略時は新規採番。import では既存の public_id をそのまま渡す。 */
  publicId?: string;
  /** canonical path。省略時は public_id そのもの。 */
  path?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * 記事を作る。posts への INSERT と canonical 行の INSERT を 1 トランザクションで行う。
 *
 * canonical を明示したときは `public_id` を alias としても入れる。**記事は常に
 * public_id で引ける**という不変条件を、URL を変えても保つため。
 */
export async function createPost(
  db: D1Database,
  input: CreatePostInput,
): Promise<Result<PostRow, PathWriteError>> {
  const publicId = input.publicId ?? newPublicId();
  const now = nowIso();
  const status = input.status ?? 'draft';
  const publishedAt =
    input.publishedAt ?? (status === 'published' ? now : null);

  let canonical = publicId;
  if (input.path !== undefined) {
    const normalized = normalizePostPath(input.path);
    if (!normalized.ok) return err(normalized.error);
    canonical = normalized.value;

    if (await findByPathCi(db, canonical)) return err({ code: 'path-taken' });
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO posts
           (public_id, title, description, body_md, status, published_at, updated_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        publicId,
        input.title,
        input.description ?? null,
        input.bodyMd,
        status,
        publishedAt,
        input.updatedAt ?? now,
        input.createdAt ?? now,
      ),
    ...initialPathStatements(db, { publicId, canonical, now }),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    // 上の SELECT との間に同じものを作られた場合。check-then-act の隙間を埋める。
    // posts と post_paths の両方に INSERT するので、どちらの衝突かで分ける。
    if (uniqueViolationTarget(error) === PUBLIC_ID_UNIQUE_TARGET) {
      return err({ code: 'public-id-taken' });
    }
    if (isPathTakenViolation(error)) return err({ code: 'path-taken' });
    throw error;
  }

  const created = await getPostByPublicId(db, publicId);
  if (!created) throw new Error(`createPost: 作った直後の記事が読めない (${publicId})`);
  return ok(created);
}

export async function getPostById(db: D1Database, id: number): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.id = ?1`)
    .bind(id)
    .first<PostRow>();
}

export async function getPostByPublicId(db: D1Database, publicId: string): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.public_id = ?1`)
    .bind(publicId)
    .first<PostRow>();
}

/** 下書きプレビュー。ハッシュで引くので、生トークンは DB に無くてよい。 */
export async function getPostByPreviewTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.preview_token_hash = ?1`)
    .bind(tokenHash)
    .first<PostRow>();
}

export type ListOptions = { limit?: number; offset?: number };

export async function getPublishedPosts(
  db: D1Database,
  options: ListOptions = {},
): Promise<PostWithPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
        WHERE ${PUBLISHED_WHERE('p')}
        ORDER BY ${PUBLISHED_ORDER}
        LIMIT ?1 OFFSET ?2`,
    )
    .bind(options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

export async function getPublishedPostsByTagSlug(
  db: D1Database,
  slug: string,
  options: ListOptions = {},
): Promise<PostWithPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
         JOIN post_tags pt ON pt.post_id = p.id
         JOIN tags t ON t.id = pt.tag_id
        WHERE ${PUBLISHED_WHERE('p')} AND t.slug = ?1
        ORDER BY ${PUBLISHED_ORDER}
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(slug, options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

export async function countPublishedPosts(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM posts p WHERE ${PUBLISHED_WHERE('p')}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 管理画面と export 用。下書きも含めて全部返す。 */
export async function listAllPosts(
  db: D1Database,
  options: ListOptions & { status?: PostStatus } = {},
): Promise<PostWithPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
        WHERE (?1 IS NULL OR p.status = ?1)
        ORDER BY coalesce(p.published_at, p.created_at) DESC, p.public_id ASC
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(options.status ?? null, options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

/** UPDATE で受け付ける列。ここに無い列はこの関数からは触れない。 */
/**
 * UPDATE で受け付ける列。
 *
 * **`status` は入れない。** `published_at` と CHECK で結ばれているので、
 * 片方だけ動かすと DB に弾かれる。`body_html` / `renderer_version` を
 * `setRenderedHtml` に分けたのと同じ理由で、公開・取り下げは名前の付いた
 * 操作 (`publishPost` / `unpublishPost`) にする。
 */
const PATCHABLE = [
  'title',
  'description',
  'body_md',
  'published_at',
  'preview_token_hash',
  'bluesky_uri',
] as const;

/** 値の型は PostRow から取る。列の一覧と型を二重に書かないため。 */
export type PostPatch = Partial<Pick<PostRow, (typeof PATCHABLE)[number]>>;

/** 記事を更新する。列を機械的に流すだけで、呼び出し側の意図は推測しない。 */
export async function updatePost(
  db: D1Database,
  id: number,
  patch: PostPatch,
): Promise<PostRow | null> {
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  for (const column of PATCHABLE) {
    const value = patch[column];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = ?${values.length}`);
  }
  values.push(nowIso());
  assignments.push(`updated_at = ?${values.length}`);

  await db
    .prepare(`UPDATE posts SET ${assignments.join(', ')} WHERE id = ?${values.length + 1}`)
    .bind(...values, id)
    .run();
  return await getPostById(db, id);
}

/**
 * 公開する。
 *
 * `published_at` は初回だけ入れて、取り下げてから再公開したときは元の日付を保つ
 * (`coalesce`)。日付を明示したいときだけ `publishedAt` を渡す。
 */
export async function publishPost(
  db: D1Database,
  id: number,
  publishedAt?: string,
): Promise<PostRow | null> {
  await db
    .prepare(
      `UPDATE posts
          SET status = 'published',
              published_at = coalesce(?1, published_at, ?2),
              updated_at = ?2
        WHERE id = ?3`,
    )
    .bind(publishedAt ?? null, nowIso(), id)
    .run();
  return await getPostById(db, id);
}

/** 取り下げる。`published_at` は残すので、再公開すると元の日付に戻る。 */
export async function unpublishPost(db: D1Database, id: number): Promise<PostRow | null> {
  await db
    .prepare("UPDATE posts SET status = 'draft', updated_at = ?1 WHERE id = ?2")
    .bind(nowIso(), id)
    .run();
  return await getPostById(db, id);
}

/**
 * 描画結果を保存する。`body_html` は派生データなので、renderer を更新したときは
 * 全記事についてこれを呼び直す。
 */
export async function setRenderedHtml(
  db: D1Database,
  id: number,
  bodyHtml: string,
  rendererVersion: string,
): Promise<void> {
  await db
    .prepare('UPDATE posts SET body_html = ?1, renderer_version = ?2 WHERE id = ?3')
    .bind(bodyHtml, rendererVersion, id)
    .run();
}

/**
 * 記事を消す。paths / media / post_tags は CASCADE で落ちる。
 *
 * **R2 のオブジェクト削除はコミット後**に行うので、消すべきキーを返す。
 * 失敗した分は孤児掃除に任せる (DB を巻き戻すより残骸の方が安い)。
 */
export async function deletePost(db: D1Database, id: number): Promise<string[]> {
  const keys = await listR2KeysByPost(db, id);
  await db.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
  return keys;
}
