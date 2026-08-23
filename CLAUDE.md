# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

https://fushihara.net/ のソース。個人ポートフォリオサイトで、UI は付箋ボードライブラリ
[@kanf/wema](https://www.npmjs.com/package/@kanf/wema) の `WemaBoard` 1 つで構成されている。
**Cloudflare Workers**（Static Assets + `/api/*` の Worker）にデプロイする。

将来 `/blog/` 配下に Astro のブログを **別 Worker** として置く前提で設計してある:

```
fushihara.net/*      → Worker: fushihara-net       (Custom Domain)
fushihara.net/blog*  → Worker: fushihara-net-blog  (Route, 未実装)
```

route は Custom Domain より優先されるので、`/blog` 配下だけがブログ Worker に届く。
ブログを足すときは `blog/` サブディレクトリに独自の `package.json` / `wrangler.jsonc` を
持つ Astro プロジェクトを作り、本体の依存には混ぜない。

## Commands

```bash
npm install
npm run dev      # vite dev。localhost:5173。@cloudflare/vite-plugin が workerd 上で
                 # /api/* を実行するので、API も含めてローカルで動く
npm run build    # wrangler types → tsc -b（型チェックのみ）→ vite build
npm run preview  # ビルドしたものを workerd で配信（localhost:4173）
npm run deploy   # build して wrangler deploy

npm test         # Vitest。worker/ は実 workerd 上で動く
npm run test:e2e # Playwright。本番ビルドを preview で配信して desktop / mobile を検証
npm run typecheck
```

lint の設定はない。型チェックは `tsc -b` が 4 つのプロジェクト
（app / worker / test / e2e）をまとめて見る。

テストの外部 API は Vitest では `vi.stubGlobal('fetch')`、E2E では
`page.route()` で止めてある。CI を zenn.dev / api.github.com の生存と
レートリミットに依存させないため。**逆に言うと上流の仕様変更は CI では
検知できない**ので、そこは手動確認に委ねている。

`test/worker.test.ts` の `call()` がクエリに `__t=N` を足しているのは、
Worker が `caches.default` を使う以上 URL が同じだとテスト間でキャッシュ
ヒットし、上流呼び出しを観測できなくなるため。

`playwright.config.ts` は **`reuseExistingServer: false`** にしてある。`preview` は
ビルド済みスナップショットを配信するだけで再ビルドしないので、居残ったサーバーを
再利用すると**古い成果物に対してテストが通ってしまい、変更が検証されない**。

main への push で `.github/workflows/deploy.yml` が同じ deploy を実行する
（`blog/**` のみの変更は `paths-ignore` でスキップ）。

## Architecture

### データとレイアウトの分離

- `src/board-data.ts` — ノート（付箋）とエッジの**静的な定義**。`WemaBoardData` を
  そのまま export する。ここの `x` / `y` は **1400x900 のリファレンスビューポート**を
  前提とした座標で、実行時にはそのまま使われない（下記参照）。
  ノートの `text` は HTML 文字列。アイコンは `simple-icons` のパスを
  data URI の SVG に組み立てる `siIcon()` ヘルパー経由で埋め込む
  （wema 公式ロゴだけは `wemaIcon()` に手書き SVG を持つ）。
- `src/main.ts` — ボードの生成と**レスポンシブ再配置**。`board-data.ts` の座標・サイズを
  起動時に `basePositions` / `baseSizes` へ退避し、`getTargetLayout()` が
  ビューポート幅から実際の配置を計算する:
  - 768px 未満（`MOBILE_BP`）: `mobileOrder` の順で 1 カラム縦積み。
    加えて `collapsed: true` のエッジを全展開する（hover できないため）
  - 768px 以上: `REF_W` / `REF_H` に対する比率でスケール。
    `poweredby` ノートだけは右下固定の例外
  - resize 時は `animateToLayout()` が JS の lerp でノートとエッジを一緒に動かす
    （CSS transition だとエッジが追従しないため）

ノートの位置やサイズを変えるときは `board-data.ts` を編集する。ただし
**新しいノートを追加したらモバイル用の `mobileOrder` にも id を足す**こと
（漏れると 768px 未満で表示されない）。

なお `email` ノートは `e-email` エッジが `collapsed: true` なので、デスクトップでは
幅 0 で畳まれた状態が正しい（hover で開く）。モバイルでは上記のとおり展開される。

### 読み取り専用ロック

初期化直後はまだ編集可能で、動的データのロードが終わってから
`board.setViewOnly(true)` でロックする。`isLocked` フラグを見て
`applyLayout()` が一時的にロックを外す仕組みなので、
プログラムからノートを更新する処理はこの経路を通す必要がある。

### 動的データ（外部 API）

`src/api.ts` がフロント側のフェッチャ、`worker/` が Worker 側のプロキシ。
ブラウザから外部 API を直接叩かないのは CORS（Zenn）とレートリミット（GitHub）の回避、
およびエッジキャッシュのため。

| エンドポイント | 上流 | ボードの反映先 |
|---|---|---|
| `/api/zenn` | zenn.dev の articles API | `zenn` ノート |
| `/api/github` | GitHub `users/:name/repos` | `oss` ノート（fork は front 側で除外） |
| `/api/github-languages` | 同上を 100 件取得 | `skills` ノート（Worker 側で言語を集計） |

- `worker/index.ts` — ルータ。`caches.default` の参照と `ctx.waitUntil` での書き込みを
  一箇所に集約しているので、**個々のハンドラはキャッシュを意識しない**
- `worker/api.ts` — 3 ハンドラ。`zenn` と `githubRepos` は上流 URL 以外同一なので
  `proxy()` に寄せてある

`loadDynamicData()` は `Promise.allSettled` なので、どれか失敗しても
`board-data.ts` の静的テキストがそのまま残る。

### ルーティング設定

`wrangler.jsonc` の `assets.run_worker_first: ["/api/*"]` で API パスだけ Worker に流す
（Pages の `_routes.json` 相当）。それ以外は静的アセットが直接返る。
`not_found_handling: "404-page"` なので、クライアントルータのないこのサイトでは
存在しないパスは素の 404 になる（`dist` に `404.html` を置けばそれが返る）。

### tsconfig が 3 つある理由

`src/`（DOM lib）と `worker/`（Workers ランタイム型）を同じ tsconfig に入れると
`Request` / `Response` / `caches` の型が衝突する。そのため
`tsconfig.app.json`（`src`）と `tsconfig.worker.json`（`worker`）に分け、
ルートの `tsconfig.json` は `references` だけを持つ。`tsc -b` が両方をまとめて見る。

`worker-configuration.d.ts` は `wrangler types` の生成物（`Env` とランタイム型）で
git 管理外。`wrangler.jsonc` を変えたら再生成が要る（`npm run build` が毎回走らせる）。

### スタイル

ダークテーマは 2 箇所に分かれる。`src/style.css` の `.wema-board` セレクタが基本で、
`src/theme.ts` の `applyDarkTheme()` はボードのマウント後に
DOM 要素へ直接 CSS カスタムプロパティを設定する（ライブラリ側のインラインスタイルに
勝つ必要があるものだけ）。値を変えるときは両方の整合を確認する。
