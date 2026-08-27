-- ローカル開発用の中身。`npm run db:seed:local` で入れる。
--
-- E2E のフィクスチャはこれとは別に用意する (実データにテストを依存させない方針)。
-- ここは画面を作りながら目で見るためのもの。
--
-- public_id は uuid v4 の形をした固定値。毎回同じ URL になるようにしてある。

DELETE FROM post_tags;
DELETE FROM tags;
DELETE FROM media;
DELETE FROM post_paths;
DELETE FROM posts;

INSERT INTO posts (public_id, title, description, body_md, status, published_at, updated_at, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ブログを始めた', 'まずは 1 本目。',
   '## はじめに' || char(10) || char(10) || '書くところを自分で持つ。' || char(10),
   'published', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('22222222-2222-4222-8222-222222222222', '画像つきの記事', '相対参照のサンプル。',
   '本文の画像は相対参照のまま置く。' || char(10) || char(10) || '![サンプル](./sample.png)' || char(10),
   'published', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
  ('33333333-3333-4333-8333-333333333333', '下書きの記事', NULL,
   'まだ公開していない。' || char(10),
   'draft', NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

-- canonical は読みやすいパス、public_id は alias。記事は常に public_id でも引ける。
INSERT INTO post_paths (path, post_id, is_canonical, created_at)
SELECT v.path, p.id, v.is_canonical, '2026-08-27T00:00:00.000Z'
  FROM (
    SELECT 'start-blog' AS path, '11111111-1111-4111-8111-111111111111' AS pid, 1 AS is_canonical
    UNION ALL SELECT '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 0
    UNION ALL SELECT 'images/sample', '22222222-2222-4222-8222-222222222222', 1
    UNION ALL SELECT '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 0
    UNION ALL SELECT '33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 1
  ) v
  JOIN posts p ON p.public_id = v.pid;

-- 2 本目の記事が `![サンプル](./sample.png)` を持つので、対応する media 行も入れる。
-- これが無いと (post_id, filename) の突き合わせが常に空振りし、「相対参照が
-- 解決される」という見たいものが seed で確かめられない。
--
-- **R2 の実体は SQL では入らない。** 画像まで表示したいときは別途置く:
--   npx wrangler r2 object put fushihara-net-lily-media/posts/sample/sample.png \
--     --local -c ./wrangler.jsonc --file ./path/to/sample.png
INSERT INTO media (public_id, post_id, filename, r2_key, mime, bytes, width, height, created_at)
SELECT '44444444-4444-4444-8444-444444444444', p.id, 'sample.png',
       'posts/22222222-2222-4222-8222-222222222222/sample.png',
       'image/png', 1024, 640, 480, '2026-08-27T00:00:00.000Z'
  FROM posts p WHERE p.public_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO tags (name, slug) VALUES ('dev', 'dev'), ('日記', '日記');

INSERT INTO post_tags (post_id, tag_id)
SELECT p.id, t.id FROM posts p, tags t
 WHERE (p.public_id = '11111111-1111-4111-8111-111111111111' AND t.slug IN ('dev', '日記'))
    OR (p.public_id = '22222222-2222-4222-8222-222222222222' AND t.slug = 'dev');
