# blog

`fushihara.net/blog` を配る Worker。**CMS の本体は [`../lily/`](../lily/)**
（npm パッケージ `@kanf/lily`）で、ここはその**利用側**。

```
lily/   CMS。サイトを 1 つも知らない
blog/   fushihara.net としての設定・テーマ・静的アセット・E2E  ← ここ
```

Worker 名は `fushihara-blog`。**D1（`fushihara-net-lily`）と R2
（`fushihara-net-lily-media`）だけ古い名前のまま**で、これは改名が中身の
引っ越しになるため（名前を揃えるために記事と添付を移す理由はない）。

守るべき外向きの契約（URL・フィード・記事の出し入れの形）は
[`CONTRACT.md`](./CONTRACT.md)。Astro から引き継いだ経緯と踏んだ穴は
[`SWITCHOVER.md`](./SWITCHOVER.md)。切り出しの経緯は
[issue #6](https://github.com/kan/fushihara.net/issues/6)。

## コマンド

```bash
# **lily を先に。** blog のビルドは管理画面を作らず、lily が同梱する
# dist/admin をコピーするだけなので、これが無いと空の管理画面が配られる
# （scripts/build.mjs が気付いて落とす）。
(cd ../lily && npm install && npm run build)

npm install
npm run build            # 静的アセットの合流（shared/public + public + lily の管理画面）
npm test                 # Vitest。**ここで見るのは配線だけ**（下記）
npm run test:e2e         # Playwright。wrangler dev に対して回す (localhost:8788)
npm run typecheck        # wrangler types → tsc（src / e2e の 2 プロジェクト）
npm run db:migrate:local # ローカル D1 にマイグレーションを当てる
npm run db:seed:local    # 開発用の記事を入れる（seeds/dev.sql）
npm run dev              # localhost:8787
```

`wrangler.jsonc` の `assets.directory` が `dist/` を指すので、**ビルドしていないと
`wrangler` も `vitest` も動かない**（`npm test` は `pretest` で自動的に走る）。

管理画面は `http://localhost:8787/blog/admin/`。ローカルでは `ACCESS_TEAM` が空
（`.dev.vars`）なので `localhostOnly` アダプタに落ちて開ける。

`wrangler` には必ず `-c ./wrangler.jsonc` を付ける。リポジトリ直下に本体の
`.wrangler/deploy/config.json` があると、wrangler が両方を見つけて落ちるため。

## lily の直し方（開発の往復）

`package.json` の依存が `"@kanf/lily": "file:../lily"` なので、`npm install` は
`node_modules/@kanf/lily` を `../lily` への**シンボリックリンク**にする。
lily の `.ts` を直せばそのまま効く（`npm link` も再インストールも要らない）。

**管理画面（Vue）と migrations だけは別。**

- 管理画面を直したら `(cd ../lily && npm run build)` → `npm run build`
- migrations を足したら `npm run db:migrate:local`
  （`wrangler.jsonc` の `migrations_dir` が `node_modules/@kanf/lily/migrations` を
  直接指しているので、**コピーは要らない**）

## 構成

```
public/       ブログ専用の静的アセット（今は ogp.png だけ）。共有は ../shared/public
seeds/        ローカルで画面を見るための中身。E2E のフィクスチャとは別物
scripts/      配信物の合流（shared/public + public + lily の dist/admin）
src/
  index.ts    Worker のエントリ。fetch は config が組んだアプリ、scheduled は控え取り
  config.ts   createLily() に渡す設定。Access / Bluesky を env から解決する
  site/       fushihara.net としてのテーマ（レイアウト・CSS・文言・クライアント JS）
    meta.ts   mount とサイト名。**テーマや CSS を import しない**（E2E が Node から読む）
test/         Vitest。**配線だけ**（Access の選ばれ方・cron・自前テーマ・日付の一致）
e2e/          Playwright。fixtures/ を import で入れて wrangler dev に対して回す
```

## テストの分かれ方

**CMS そのもののテストは lily にある。** ルーティング・フィード・管理 API・
テーマの差し替え可能性・portable な往復は、利用側を 1 つも知らない状態で
あちらが見る（`lily/test/`）。

こちらが見るのは fushihara.net の配線だけ。

- Cloudflare Access が選ばれる条件（`authMode`）と、設定が無いときに
  **実ドメインからは開かない**こと
- `scheduled` ハンドラの配線（binding の名前・保持数の受け渡し）
- 自前テーマが出ていること（標準テーマの文言が混ざっていないこと）
- favicon 3 点と `og:image` の link が実体を指すこと
- 公開ページの日付（`../shared/date.ts`）と管理画面の日付（`SiteConfig.timeZone`）が
  一致すること

E2E は**生成器を差し替えても入出力の契約は変わらない**を確かめるハーネスなので、
lily を入れ替えても `e2e/blog.spec.ts` がそのまま合否判定に使える。実際、
切り出しの検証はこれで取った。

## テーマ

`src/site/` が `Theme`（`@kanf/lily` の型）を実装している。標準テーマ
（`@kanf/lily/theme`）は使わず、**写して直した別実装**という位置づけ。

- 色とフォントのトークンは `../shared/tokens.css`（本体サイトと共用）
- テーマの保存キーは `../shared/theme.ts` の `STORAGE_KEY`（`/` と `/blog/` を
  行き来したときに選択が引き継がれるため）
- 日付は `../shared/date.ts`（本体サイトの Blog 付箋と同じ関数）

**lily の標準テーマはこれらを 1 つも読めない**（npm で配るものが、載せる側の
リポジトリのファイルを読めるはずがない）。だから 2 本ある。
