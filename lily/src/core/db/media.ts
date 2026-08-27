/**
 * 添付。本文の相対参照 (`./sample.png`) と `(post_id, filename)` で突き合わせる。
 *
 * 原本は R2 にあり、この表は「どの記事のどのファイル名が、どの R2 キーか」の
 * 対応だけを持つ。配信 URL は `urlForMedia()` が `public_id` から組む。
 */
import { newPublicId, nowIso } from '../ids.ts';
import { MEDIA_COLUMNS, type MediaRow } from './types.ts';

const MEDIA_SELECT = MEDIA_COLUMNS.join(', ');

export type CreateMediaInput = {
  postId: number | null;
  filename: string;
  r2Key: string;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  /** import で既存の public_id を保つときだけ渡す。 */
  publicId?: string;
};

export async function createMedia(db: D1Database, input: CreateMediaInput): Promise<MediaRow> {
  const publicId = input.publicId ?? newPublicId();
  await db
    .prepare(
      `INSERT INTO media (public_id, post_id, filename, r2_key, mime, bytes, width, height, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      publicId,
      input.postId,
      input.filename,
      input.r2Key,
      input.mime,
      input.bytes,
      input.width ?? null,
      input.height ?? null,
      nowIso(),
    )
    .run();

  const created = await getMediaByPublicId(db, publicId);
  if (!created) throw new Error(`createMedia: 作った直後の media が読めない (${publicId})`);
  return created;
}

export async function getMediaByPublicId(
  db: D1Database,
  publicId: string,
): Promise<MediaRow | null> {
  return await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE public_id = ?1`)
    .bind(publicId)
    .first<MediaRow>();
}

/** 本文の `./sample.png` を placeholder に置き換えるときに使う。 */
export async function findByPostAndFilename(
  db: D1Database,
  postId: number,
  filename: string,
): Promise<MediaRow | null> {
  return await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE post_id = ?1 AND filename = ?2`)
    .bind(postId, filename)
    .first<MediaRow>();
}

export async function listMediaByPost(db: D1Database, postId: number): Promise<MediaRow[]> {
  const { results } = await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE post_id = ?1 ORDER BY filename ASC`)
    .bind(postId)
    .all<MediaRow>();
  return results;
}

/** フィードのように複数記事をまとめて描画するときの N+1 回避。 */
export async function listMediaByPosts(
  db: D1Database,
  postIds: number[],
): Promise<MediaRow[]> {
  if (postIds.length === 0) return [];
  const placeholders = postIds.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT ${MEDIA_SELECT} FROM media WHERE post_id IN (${placeholders}) ORDER BY filename ASC`,
    )
    .bind(...postIds)
    .all<MediaRow>();
  return results;
}

/**
 * 記事に紐づく R2 のキー。記事を消す前に控えておくために使う
 * (`media` を読むのはこのファイルだけ、という線を守るために置いている)。
 */
export async function listR2KeysByPost(db: D1Database, postId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT r2_key FROM media WHERE post_id = ?1')
    .bind(postId)
    .all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}

/** 消した行の R2 キーを返す。R2 のオブジェクト削除は呼び出し側がコミット後に行う。 */
export async function deleteMedia(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT r2_key FROM media WHERE id = ?1')
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) return null;
  await db.prepare('DELETE FROM media WHERE id = ?1').bind(id).run();
  return row.r2_key;
}
