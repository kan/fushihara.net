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
import { isUniqueViolation } from './errors.ts';
import { listR2KeysByPost } from './media.ts';
import { findByPathCi, insertPathStatement, type PathWriteError } from './post-paths.ts';
import {
  postColumns,
  type PostRow,
  type PostStatus,
  type PostWithPathRow,
} from './types.ts';

/** 一覧・フィード共通の並び。 */
const PUBLISHED_ORDER = 'p.published_at DESC, p.public_id ASC';

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
    insertPathStatement(db, { path: canonical, publicId, isCanonical: true, now }),
  ];
  if (canonical !== publicId) {
    statements.push(insertPathStatement(db, { path: publicId, publicId, isCanonical: false, now }));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    // 上の SELECT との間に同じパスを作られた場合。check-then-act の隙間を埋める。
    if (isUniqueViolation(error)) return err({ code: 'path-taken' });
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
        WHERE p.status = 'published'
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
        WHERE p.status = 'published' AND t.slug = ?1
        ORDER BY ${PUBLISHED_ORDER}
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(slug, options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

export async function countPublishedPosts(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT count(*) AS n FROM posts WHERE status = 'published'")
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
const PATCHABLE = [
  'title',
  'description',
  'body_md',
  'status',
  'published_at',
  'preview_token_hash',
  'bluesky_uri',
] as const;

/** 値の型は PostRow から取る。列の一覧と型を二重に書かないため。 */
export type PostPatch = Partial<Pick<PostRow, (typeof PATCHABLE)[number]>>;

/**
 * 記事を更新する。`body_html` と `renderer_version` はここでは触れない
 * (2 列そろっていないと CHECK に弾かれるので `setRenderedHtml` に分けてある)。
 *
 * **`status: 'published'` だけを渡す「公開ボタン」の呼び方を成立させる。**
 * `published_at` が未設定のまま公開にすると CHECK に弾かれるので、その場合だけ
 * 現在時刻を補う (既に日付が入っている記事の再公開では元の日付を保つ)。
 */
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
  if (patch.status === 'published' && patch.published_at === undefined) {
    values.push(nowIso());
    assignments.push(`published_at = coalesce(published_at, ?${values.length})`);
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
