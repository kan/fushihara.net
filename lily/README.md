# lily

`/blog` を Astro（ファイルベース）から置き換える、D1 を正とする自作 CMS。
まずこのリポジトリ内の Worker として作り、コアは将来 OSS（`lily`）として切り出す。

設計の全体像と決定事項は
[issue #5](https://github.com/kan/fushihara.net/issues/5) が正本。

## 今できていること

- D1 のスキーマとマイグレーション（`STRICT` / `CHECK` / index）
- `src/core/db/` の query layer（記事・パス・添付・タグ）
- `src/core/paths.ts`（`mountPath` と URL 生成、`normalizePostPath`、予約パス）

まだ何も配信していない。`src/index.ts` は 404 を返すだけの入口。

## コマンド

```bash
npm install
npm test                 # Vitest。実 workerd + 実 D1 で動く
npm run typecheck        # wrangler types → tsc
npm run db:migrate:local # ローカル D1 にマイグレーションを当てる
npm run db:seed:local    # 開発用の記事を入れる（seeds/dev.sql）
```

`wrangler` には必ず `-c ./wrangler.jsonc` を付ける。リポジトリ直下に本体の
`.wrangler/deploy/config.json` があると、wrangler が両方を見つけて落ちるため。

## 構成

```
migrations/   D1 のマイグレーション（plain SQL）。スキーマの正はここだけ
seeds/        ローカルで画面を見るための中身。E2E のフィクスチャとは別物
src/
  core/       将来 lily として切り出す部分（サイト固有を何も知らない）
    db/       Row 型とクエリ。SQL はここから出さない
    paths.ts  mountPath と URL 生成、normalizePostPath
    routes/   ルーティング定義（fixed.ts が予約パスの正本）
  site/       fushihara.net 固有（レイアウト・CSS・文言）※これから
  admin/      Vue の管理画面 ※これから
test/         Vitest
```

## 設計で外せない 3 点

後から変えるとデータ移行や URL 互換に直接響くので、ここだけは先に決めてある。

1. **記事の identity と URL を分離する。** identity は不変の `public_id`（uuid v4）で、
   URL は `post_paths`。URL は後から変えられて、旧 URL は alias として残る
2. **Markdown は deployment を知らない。** 本文に `/blog/...` を埋め込まない。
   画像は `./sample.png` の相対参照のまま保存し、公開 URL は描画時に解決する
3. **`mountPath` は第一級の設定。** `/blog` にも root にもマウントできる。
   URL を組むのは `core/paths.ts` だけ

## テストの方針

- D1 の制約（`STRICT` / `CHECK` / 部分ユニーク索引）は**生 SQL で叩いて確かめる**。
  アプリ側の検証を通らない経路でも壊れた行が入らないこと自体が仕様なので、
  query layer 越しに見ても検証にならない
- スキーマの正は `migrations/*.sql` の 1 箇所。テストは
  `readD1Migrations()` でそれを読んで適用する。テストだけ別のスキーマを持たない
