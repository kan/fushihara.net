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

E2E で踏みやすい罠が 2 つある。

- `playwright.config.ts` は **`reuseExistingServer: false`** にしてある。`preview` は
  ビルド済みスナップショットを配信するだけで再ビルドしないので、居残ったサーバーを
  再利用すると**古い成果物に対してテストが通ってしまい、変更が検証されない**
- `page.emulateMedia()` を**連続で呼ぶと変更が合体して `change` が飛ばない**。
  OS 設定の変化を 2 段階で試すときは、1 段ずつ発火を確認してから次へ進める
  （`e2e/theme.spec.ts` の「保存だけ失敗する環境でも〜」参照）

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

### tsconfig を分けている理由

`src/`（DOM lib）と `worker/`（Workers ランタイム型）を同じ tsconfig に入れると
`Request` / `Response` / `caches` の型が衝突する。そのため
`tsconfig.app.json`（`src`）/ `tsconfig.worker.json`（`worker`）/
`tsconfig.test.json` / `tsconfig.e2e.json` に分け、共通のコンパイラオプションは
`tsconfig.base.json` に置く。ルートの `tsconfig.json` は `references` だけを持ち、
`tsc -b` が 4 つをまとめて見る。

`worker-configuration.d.ts` は `wrangler types` の生成物（`Env` とランタイム型）で
git 管理外。`wrangler.jsonc` を変えたら再生成が要る（`npm run build` が毎回走らせる）。

### テーマ（ライト / ダーク）

色は **すべて `src/style.css` の CSS カスタムプロパティ**に集約してある。
JS は `data-theme` を切り替えるだけで、色を一切持たない。

```
:root                                  color-scheme: dark（既定）
:root[data-theme='light']              color-scheme: light
@media (prefers-color-scheme: light)
  :root:not([data-theme='dark'])       JS 無しでも OS 設定に従う
```

**色は `light-dark(ライト値, ダーク値)` で 1 回だけ書く。** どちらが使われるかは
`color-scheme` が決めるので、2 つのパレットがずれようがない。Vite 8 の Lightning CSS
が古いブラウザ向けのフォールバックを自動生成するため、対応状況を気にする必要もない。

例外は `--icon-filter` と `--icon-opacity` の 2 つ。`light-dark()` は色専用で
`filter` や数値には使えないため、この 2 つだけ 3 ブロックに分かれている。
**触るときは 3 箇所すべて直す。**

- `src/theme.ts` — DOM に触れない純粋モジュール（`nextTheme` / `resolveInitialTheme`）。
  workerd プールのユニットテストから使えるようにこの形にしている
- `src/theme-toggle.ts` — DOM 側。`localStorage` は**プライベートモードで throw する**ので
  try/catch で包む。OS 設定に追従するかどうかは保存値ではなく `chosen` フラグで判定する。
  `getItem` は通るのに `setItem` だけ throw する環境（Safari プライベートモード /
  QuotaExceededError）で、保存に失敗したユーザーの選択を OS 側の変更に奪われないため
- `index.html` の `<head>` にある同期スクリプトが、保存値を**描画前に** `data-theme` へ
  stamp する。モジュールスクリプトは defer なので、これが無いとちらつく。
  `STORAGE_KEY` の文字列をここに直書きしているので、変えるときは両方直す

### wema のサニタイザという制約（重要）

wema はノートの `text` を **許可リストでサニタイズ**する
（`node_modules/@kanf/wema/dist/wema.js` の `src/utils/sanitize.ts` 領域）。

- **`svg` と `button` は除去される** → 対話的な UI をノート内に置くことはできない。
  テーマトグルが `#app` の外にいるのはこのため
- `class` は全タグで通る。`style` は
  `color / background-color / font-size / font-weight / font-style / text-decoration /
  text-align / margin / padding / display / list-style-type / white-space` だけ通る
- したがって**ノート内の色はインライン `style` ではなく class で当てる**。
  二次テキストは `class="muted"`（`--text-muted` に追従）。インラインで色を書くと
  片方のテーマに固定されてしまう

`board-data.ts` のアイコンは `#999` を焼き込んだ data URI なので、テーマ追従は
CSS の `filter: var(--icon-filter)` で行っている（ライトでは `invert(1)`）。

wema が `--wema-anchor-color` から塗る折りたたみバッジは、アンカーを隠すために
その変数を `transparent` にしている都合で**素の板に白文字が乗る**。
`.wema-note-collapse-btn` / `-badge` に独自の背景を当てて回避している。

### スタイルの上書きが効く理由

`main.ts` は wema の CSS を読んだ**後**に `src/style.css` を読むので、同じ
`.wema-board` セレクタでこちらが勝つ。wema が JS からインライン設定するのは
`--wema-note-color`（ノート左端の帯）だけなので、他はすべて CSS で上書きできる。
