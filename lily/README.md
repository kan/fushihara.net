# lily

`/blog` を Astro（ファイルベース）から置き換える、D1 を正とする自作 CMS。
まずこのリポジトリ内の Worker として作り、コアは将来 OSS（`lily`）として切り出す。

設計の全体像と決定事項は
[issue #5](https://github.com/kan/fushihara.net/issues/5) が正本。

## 今できていること

- D1 のスキーマとマイグレーション（`STRICT` / `CHECK` / index）
- `src/core/db/` の query layer（記事・パス・添付・タグ）
- `src/core/paths.ts`（`mountPath` と URL 生成、`normalizePostPath`、予約パス）
- `src/core/render/`（CommonMark + GFM、Shiki、相対参照 → placeholder）
- 公開側の SSR（一覧・記事・タグ・404・alias 308・下書きプレビュー）と CSS の移植

まだデプロイしていない（route を張っていない）。ローカルでは動く。

## コマンド

```bash
npm install
npm test                 # Vitest。実 workerd + 実 D1 で動く
npm run typecheck        # wrangler types → tsc
npm run db:migrate:local # ローカル D1 にマイグレーションを当てる
npm run db:seed:local    # 開発用の記事を入れる（seeds/dev.sql）
npm run dev              # localhost:8787。上の 2 つを先に流しておくこと
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
    paths.ts  mountPath と URL 生成、normalizePostPath / normalizeSegment
    slug.ts   タグ名 → slug（最後は normalizeSegment を通す）
    render/   Markdown → HTML。保存する側と配信する側で 2 段に分ける
    routes/   fixed.ts がルーティング定義の正本、public.ts が公開側のルータ
    theme.ts  テーマが実装する型。core は HTML を 1 バイトも持たない
  site/       fushihara.net 固有（レイアウト・CSS・文言・OGP・クライアント JS）
  admin/      Vue の管理画面 ※これから
  config.ts   サイト設定。createLily() に渡す
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

## 描画（`core/render/`）

```
body_md ──renderMarkdown()──▶ body_html（保存。mount を知らない）
                                 └──resolveMediaUrls()──▶ 配信する HTML
```

保存する HTML には `lily-media://<public_id>/<filename>` という placeholder が
入っていて、実際の URL は配信時に組む。**この分離があるので `mountPath` を
変えても `body_html` の再生成が要らない**（`/blog-next` と `/blog` が同じ D1 を
見て同時に正しい URL を出せる）。

- **`rehype-raw` は使わない。** HTML を parse5 で読み直すので、表の中の改行が
  foster parenting で表の外へ追い出される（`</pre>` と `<table>` の間に空行が
  14 行並ぶ）。生 HTML は raw ノードのまま最後まで運ぶ
- **Shiki は `defaultColor: false` を維持する。** 色を直接書かせず
  `--shiki-light` / `--shiki-dark` だけを出させて CSS の `light-dark()` に渡す。
  `'light'` にすると `!important` が要るようになる
- 載せる言語は `render/highlighter.ts` の `LANGS`。**バンドルに入る**ので、
  書かない言語は入れない（現在 18 言語 + 2 テーマで Worker 全体が gzip 267 KiB）
- Astro は `pre.astro-code` を出していたが、Shiki 素のクラス名は `pre.shiki`。
  CSS を移植するときに読み替えること

## 1 箇所に閉じてあるもの

同じ規則が 2 箇所にあると、片方だけ直した日に黙って食い違う。次は意図的に
1 箇所へ寄せてある。

| 何 | どこ |
|---|---|
| ルーティング（予約パスと URL のセグメント名） | `core/routes/fixed.ts` の `ROUTE` |
| URL を組む場所 | `core/paths.ts`（`createUrls`） |
| 「URL セグメントとして安全か」 | `core/paths.ts` の `normalizeSegment` |
| 「公開記事とは何か」 | `core/db/posts.ts` の `PUBLISHED_WHERE` |
| SELECT する列 | `core/db/types.ts`（Row 型から導出） |
| 「記事は常に public_id で引ける」 | `core/db/post-paths.ts` |
| 生成済み HTML の後処理を開始タグに限る | `core/render/html.ts` の `mapOpenTags` |
| 見た目・文言・OGP（差し替え点） | `core/theme.ts` の `Theme` を `site/` が実装 |

## テストの方針

- D1 の制約（`STRICT` / `CHECK` / 部分ユニーク索引）は**生 SQL で叩いて確かめる**。
  アプリ側の検証を通らない経路でも壊れた行が入らないこと自体が仕様なので、
  query layer 越しに見ても検証にならない
- スキーマの正は `migrations/*.sql` の 1 箇所。テストは
  `readD1Migrations()` でそれを読んで適用する。テストだけ別のスキーマを持たない
