/**
 * 管理 API の入力。**外から来るものはここを通る。**
 *
 * zod は外部入力の検証、TypeScript はアプリ内部の型、SQLite の制約が永続化時の
 * 最後の砦。3 層のうち、この層が受け持つのは「形が合っているか」だけで、
 * 「そのパスが空いているか」のような DB を見ないと分からないことは query layer が返す。
 *
 * リクエストの型はここで 1 度だけ定義し、**レスポンスの型は handler から推論**させる
 * (Hono RPC)。手で書いた型と実装がずれる余地を作らない。
 */
import { z } from 'zod';

/** UTC ISO8601。DB に入る形に揃える。 */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日時として読めない')
  .transform((value) => new Date(value).toISOString());

/** 空文字は「書いていない」と同じ扱いにする (フォームは空欄を空文字で送る)。 */
const optionalText = z
  .string()
  .transform((value) => (value.trim() === '' ? null : value))
  .nullable();

export const createPostSchema = z.object({
  title: z.string().min(1, 'タイトルは必須'),
  bodyMd: z.string().default(''),
  description: optionalText.optional(),
  /** 省略すると public_id がそのまま URL になる。 */
  path: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updatePostSchema = z.object({
  title: z.string().min(1).optional(),
  bodyMd: z.string().optional(),
  description: optionalText.optional(),
  tags: z.array(z.string()).optional(),
});

export const publishSchema = z.object({
  /** 省略すると初回は現在時刻、再公開では元の日付を保つ。 */
  publishedAt: isoDateTime.optional(),
});

export const pathSchema = z.object({
  path: z.string().min(1),
});

export const listPostsSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
