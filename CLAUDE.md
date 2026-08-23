# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

https://fushihara.net/ のソース。個人ポートフォリオサイトで、UI は付箋ボードライブラリ
[@kanf/wema](https://www.npmjs.com/package/@kanf/wema) の `WemaBoard` 1 つで構成されている。
**Cloudflare Workers**（Static Assets + `/api/*` の Worker）にデプロイする。

`/blog/` 配下は Astro のブログで、**別 Worker** として動く:

```
fushihara.net/*      → Worker: fushihara-net       (Custom Domain)
fushihara.net/blog*  → Worker: fushihara-net-blog  (Route)
```

route は Custom Domain より優先されるので、`/blog` 配下がブログ Worker に届く。

**末尾の `*` は必須。** route はクエリ文字列まで含めて URL 全体と突き合わせ、パターンに
`?` は書けないため、`*` で終わらせないとクエリ付き URL に一致しない。`/blog` と
`/blog/*` の 2 本に分けていたときは、`/blog?utm_source=...` が本体 Worker に落ちて
真っ白な 404 になっていた（本番で踏んだ）。`/blog/*` 側は末尾が `*` なので無事だった。

代償として `/blogfoo` もブログ Worker に届く（ブログの 404 ページが出る）。本体は `/` と
`/api/*` しか持たないので実害は無く、将来 `/blogroll` のようなパスが要るなら、より長い
route を足せばそちらが優先される。

ブログは `blog/` に独自の `package.json` / `wrangler.jsonc` を持つ独立プロジェクトで、
依存は本体と混ざっていない。詳細は「ブログ」節と `blog/CONTRACT.md`。

リポジトリ直下の `shared/` だけが両方から読まれる（色トークンとテーマの保存キー）。

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

ブログは別プロジェクトなので、`blog/` に降りて別の npm scripts を使う:

```bash
cd blog
npm install
npm run dev       # astro dev。localhost:4321/blog/
npm run dev:fixtures # 同上だが E2E のフィクスチャを読ませる（描画確認用）
npm run build     # dist/blog/ に静的出力
npm run typecheck # astro check
npm run test:e2e  # Playwright。ビルドして wrangler dev で配信し検証
npm run deploy    # build して wrangler deploy
```

lint の設定はない。型チェックは本体側が `tsc -b` で 4 つのプロジェクト
（app / worker / test / e2e）を、ブログ側が `astro check` をそれぞれ見る。
本体の `tsc -b` は `blog/` を含まない。

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

## コミット前の手順

**コード変更を含むコミットの前に、次を順に実行する。**

1. `/code-review` — 実害のあるバグを洗う
2. `/simplify` — 重複・冗長・設計の深さを見て直す
3. `npm run typecheck && npm test && npm run test:e2e`
4. ユーザーの承認を得てからコミットする

順番に実行すること。`/simplify` は修正を適用するので、`/code-review` と
並行させると衝突する。ドキュメントだけの変更ならスキップしてよい。

指摘に対応したら、**意図的に実装を壊して該当テストだけが落ちることを確認する**。
このリポジトリでは、通ったはずのテストが実は何も検証していなかった例が
複数回あった（詳細は「動的データ」節の E2E の罠を参照）。

なお `/code-review` と `/simplify` のサブエージェントが結果を返さないことがある。
その場合は待たずに、同じ観点を自分で見て直す。

### 記事だけのコミットは例外

**変更が `blog/content/` 配下だけ（記事本文とその画像）なら、上の 1〜3 は飛ばす。**
`cd blog && npm run build` が通ることだけ確認してコミットする。

記事を 1 本書くたびにレビューと E2E を回すのは割に合わない。ビルドは数秒で終わり、
記事で実際に踏んだ失敗（frontmatter の型エラー / 画像パスのタイプミス /
`index.md` 以外の Markdown）はすべてここで止まる。E2E は push 後に CI が回す。

`blog/content/` 以外のファイルが 1 つでも混ざっていたら、通常の手順に戻ること。
`blog/src/` や `blog/test-content/` を触ったなら記事だけのコミットではない。

## CI とデプロイ

ワークフローは 2 本ある。本体が `.github/workflows/deploy.yml`、ブログが
`.github/workflows/deploy-blog.yml`。デプロイ先の Worker が別なので分けてある。

### 本体（deploy.yml）

main への push で動く。

- `test` は**変更の内容によらず必ず走る**（push / pull_request の両方）
- `deploy` は `changes` ジョブの判定で、**配信物に影響する変更があるときだけ**走る。
  対象は `src/` `shared/` `worker/` `public/` `index.html` `package.json`
  `package-lock.json` `vite.config.ts` `wrangler.jsonc`。ドキュメント・テスト・
  tsconfig・CI 設定だけの変更ではデプロイしない
- 判定の比較元は **`deployed` タグ**（deploy ジョブが成功時に進める軽量タグ）。
  直前の push と比べてはいけない。テスト失敗などでデプロイされずに終わった変更が、
  次の無関係な push で「変更なし」と判定されて**恒久的に取り残される**ため。
  タグが無いときは安全側に倒してデプロイする
- スキップされた後に手で出したいときは `workflow_dispatch`（Actions 画面の Run workflow）
- `blog/**` のみの変更は `paths-ignore` でワークフローごとスキップ（ブログ側が拾う）

注意点:

- **`.github/` は `deploy_paths` に入っていない。** deploy ステップ自体を変えた
  （`wrangler deploy` にオプションを足した等）コミットではデプロイが走らないので、
  その変更を試したいときは `workflow_dispatch` を回す
- デプロイ先を変えるパスを増やしたら `deploy_paths` にも足すこと
- `git diff` には **`--no-renames`** が要る。付けないと配信パスの外へ移動した
  ファイルが移動先しか出力されず、削除を見落とす
- 判定は `grep -qE ... <<< "$changed"` と here-string で書く。パイプにすると
  `grep -q` の即時終了で `echo` が SIGPIPE を受け、`pipefail` により
  **黙って「変更なし」と誤判定する**（ジョブは成功したまま）
- `deployed` タグは毎回 force update されるので、手元で `git fetch --tags` すると
  `would clobber existing tag` と拒否されることがある。`git fetch --tags --force`
  で解消する（通常の `git pull` では起きない）

### ブログ（deploy-blog.yml）

`blog/**` `shared/**` と自分自身が変わったときだけ動く。

**本体の `changes` ジョブ（`deployed` タグとの差分判定）は意図的に持ち込んでいない。**
`paths` フィルタが既に「ブログに関係する変更のときだけ動く」を保証しているうえ、
ブログは毎回フル静的ビルドなので、テスト失敗でデプロイされずに終わった変更も次の
push で丸ごと出し直される。本体にあの仕組みが要るのは「取り残しが恒久化する」問題が
あるからで、ここに同じものを置くと `deployed` タグの衝突と複雑さだけが残る。

`shared/` を変えると本体とブログの両方のワークフローが走る（どちらの配信物にも入るため）。

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

`shared/` は `src/` の外にあるので、`composite: true` の都合で参照する側の `include`
に明示的に足す必要がある（列挙していないファイルを import するとエラーになる）。
`blog/` は独立プロジェクトなので、この `references` には入らない（`astro check` が見る）。

`worker-configuration.d.ts` は `wrangler types` の生成物（`Env` とランタイム型）で
git 管理外。`wrangler.jsonc` を変えたら再生成が要る（`npm run build` が毎回走らせる）。

### テーマ（ライト / ダーク）

色は **すべて `shared/tokens.css` の CSS カスタムプロパティ**に集約してある。
本体サイト（`src/style.css`）とブログ（`blog/src/styles/blog.css`）が両方これを
`@import` する。パレットを 2 箇所に持つと必ずずれるので、色の定義はここだけに置く。
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

- `shared/theme.ts` — DOM に触れない純粋モジュール（`STORAGE_KEY` / `nextTheme` /
  `resolveInitialTheme`）。workerd プールのユニットテストから使えるようにこの形に
  している。ブログも同じものを読む。**`STORAGE_KEY` が本体とブログでずれると、
  `/` と `/blog/` を行き来したときにテーマの選択が引き継がれない**
- `shared/theme-storage.ts` — 保存の読み書き。`localStorage` は**プライベートモードで
  throw する**ので try/catch で包む。本体とブログで共用するのは、保存の扱いが
  ずれると片方だけテーマが消えるため。`theme.ts` と分けてあるのは、あちらを DOM に
  触れない純粋モジュールに保つため（workerd プールのテストから読む）
- `src/theme-toggle.ts` / `blog/src/scripts/theme-toggle.ts` — 各サイトの DOM 側。
  ボタンの作り方が違う（本体は JS で生成、ブログは静的 HTML にあるものを拾う）ので
  分かれている。OS 設定に追従するかどうかは保存値ではなく `chosen` フラグで判定する。
  `getItem` は通るのに `setItem` だけ throw する環境（Safari プライベートモード /
  QuotaExceededError）で、保存に失敗したユーザーの選択を OS 側の変更に奪われないため
- `index.html` の `<head>` にある同期スクリプトが、保存値を**描画前に** `data-theme` へ
  stamp する。モジュールスクリプトは defer なので、これが無いとちらつく。
  `STORAGE_KEY` の文字列をここに直書きしているので、変えるときは両方直す
  （ブログ側は `Base.astro` が `shared/theme.ts` から埋め込むので直書きしていない）

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

## ブログ（blog/）

`/blog/` 配下。Astro の静的サイトを `fushihara-net-blog` Worker として配る。

**Astro は使い捨ての足場**として置いている。将来ここを自作 OSS の生成器に置き換える
前提なので、移行で持ち越すもの（Markdown 本文 / URL / HTML と CSS / E2E）を汚さない
ことが最優先。守るべき線は `blog/CONTRACT.md` に書いてあり、そちらが正本。

要点だけ:

- **MDX を使わない。Astro のテーマを入れない。フロントマターに生成器固有のキーを
  足さない。** どれも破ると移行費用が跳ね上がる
- 記事は `blog/content/posts/<slug>/index.md` の 1 形式。画像は同じディレクトリに
  置いて相対パスで参照する。`src/` の外に置いてあるのは「記事はコードではなく資産」
  を構成で示すため
- **E2E は `blog/test-content/posts/` のフィクスチャに対して回す。** 実記事に依存させると
  記事を書き換えるたびにテストが落ちる。切り替えは `playwright.config.ts` が渡す
  `BLOG_CONTENT_DIR` で、素の `npm run build` は必ず `content/posts` を読む
- URL は `/blog/<slug>/`（末尾スラッシュあり）で固定。RSS は `/blog/rss.xml`。
  **公開後は変えない**
- フロントマターのスキーマは `blog/src/content.config.ts` に zod で書いてある。
  これは Astro のための設定であると同時に、自作ツールへの仕様書でもある
- `blog/e2e/blog.spec.ts` は Astro の API に一切触れていない。生成器を差し替えた日に
  そのまま合否判定として使うためのハーネスなので、**Astro 固有の検証をここに足さない**

### 踏んだ罠

- **`base: '/blog'` を付けても Astro の出力パスには base が入らない。** リンクだけが
  `/blog/…` になり、ファイルは `dist/` 直下に出る。Worker には `dist/` をそのまま
  配らせたいので、`outDir: './dist/blog'` で出力側を base に合わせている。
  片方だけ変えると 404 になるので、`astro.config.mjs` と `wrangler.jsonc` の
  `assets.directory` は必ずセットで見る
- **`blog/` から `wrangler` を叩くときは `-c ./wrangler.jsonc` が要る。** リポジトリ
  直下に本体の `.wrangler/deploy/config.json`（`@cloudflare/vite-plugin` の生成物）が
  あると、wrangler が両方を見つけて「どちらの設定か分からない」で落ちる
- **E2E は `astro preview` ではなく `wrangler dev` に対して回している。** 末尾スラッシュの
  補完と `404.html` の解決は Workers のアセット配信側の挙動なので、静的サーバー相手に
  テストしても本番を検証したことにならない
- テーマ切り替えの背景色は `transition` が乗っているので、クリック直後に
  `getComputedStyle` を読むとまだ遷移前の値が返る。`expect.poll` で待つこと
  （本体の `e2e/theme.spec.ts` も同じ理由でそうしている）
- ボタンのアイコンは両方 HTML に置いて CSS で出し分けている。静的生成の時点では
  訪問者のテーマが分からないので、JS で差し込むと一瞬まちがった方が見える
  （`aria-label` だけは読み込み後に方向つきへ差し替える。静的 HTML 側は中立な文言）
- **コードハイライトは `defaultColor: false`。** Shiki に色を直接書かせず
  `--shiki-light` / `--shiki-dark` だけ出させて、`light-dark()` に渡している。
  他の色とまったく同じ扱いになるので、`[data-theme]` とメディアクエリのブロックが
  要らない（`!important` も要らない）
- `base` の正規化は `blog/src/lib/paths.ts` に閉じてある。`import.meta.env.BASE_URL` の
  末尾スラッシュは `trailingSlash` 設定に左右されるので、素で連結しないこと
- **E2E のポートは 4322。** `astro dev` の既定 4321 と分けてある。`reuseExistingServer:
  false` なので、同じにすると dev サーバーを開いたままテストを回せない
- `npm run build` が `rm -rf dist` から始まるのは、`outDir` が `dist/blog` なので
  `astro build` が `dist/` 直下を掃除しないため。放っておくと古い成果物が
  `wrangler deploy` で一緒に上がる
- **フィクスチャを `content/` に置かないこと。** 置くと公開される。`draft: true` の
  除外を守っているのは `test-content/posts/draft-example/` と `e2e/blog.spec.ts` の
  「下書き」節だけなので、どちらも消さない
- **content layer のストアは読み込み先ディレクトリを覚えていない。** 何もしないと
  `BLOG_CONTENT_DIR` を切り替えたときに前のモードの記事が残り、**素のビルドや dev に
  E2E のフィクスチャが出る**（どちらも実測で踏んだ）。厄介なのは **ストアの場所が
  ビルドと dev で違う**こと:

  | | ストアの場所 | 対策 |
  |---|---|---|
  | `astro build` | `cacheDir`（既定 `node_modules/.astro/`） | `astro.config.mjs` が `BLOG_CONTENT_DIR` の有無で `cacheDir` を分ける + `clean:build-store` |
  | `astro dev` | **`.astro/`**（`cacheDir` ではない） | `clean:dev-store` が起動のたびに捨てる |

  ビルド側で `cacheDir` を分けているのは、**dev サーバーを立てたまま E2E を回しても
  互いを壊さない**ようにするため（捨てるだけの方式では、動いている dev を守れない）。
  最後の砦として `npm run deploy` と CI が `check:no-fixtures` で配信物を検査する
- **frontmatter は「キーはあるが値が空」を省略と同じ扱いにしてある。** YAML では
  `description:` が `null` になり、素の zod だと `Expected string, received object` で
  落ちる。テンプレートを埋めながら書けば必ず踏むので `blankAsUnset()` で吸収している
  （`title` / `date` は必須なので空欄はエラーのまま）。`test-content/posts/draft-example/`
  の空欄キーがこれの検査を兼ねている
- **読み込まれるのは `**/index.md` だけ。** 直置きの `posts/foo.md` も、記事の隣の
  `notes.md` も**黙って無視される**（ビルドは成功するのに記事が出ない）。
  `check:post-layout` がビルド前に止める。逆にディレクトリは何階層でも掘れて、
  `posts/a/b/index.md` は `/blog/a/b/` になる（構造がそのまま URL）
- **`astro build` は記事の削除・リネームをストアに反映しない。** 消したはずの記事が
  ページ・一覧・RSS に出続ける（実測。ビルドエラーにすらならない）。画像を含む記事だと
  `ImageNotFound` でビルドが落ちるので気付けるが、画像が無ければ黙って公開され続ける。
  `clean:build-store` がビルドのたびにストアを捨てているのはこのため
- フィクスチャの見た目を確認したいときは `npm run dev:fixtures`
- **ヘッダーは `fushihara.net / blog` のパンくず 1 本。** 「どこの」「何か」を示しつつ
  戻り道も兼ねるので、nav にポートフォリオへのリンクは置かない。一覧ではこのパンくずが
  そのままページの見出しなので `h1`、記事ページでは `h1` は記事タイトルのものなので
  `p` に落としている（`Base.astro` の `Brand` 変数）
- `content/posts/` が空のあいだ、ビルドが「The collection "posts" does not exist or is
  empty」と警告する。記事を 1 本置けば消える
