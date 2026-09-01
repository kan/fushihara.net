# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

https://fushihara.net/ のソース。個人ポートフォリオサイトで、UI は付箋ボードライブラリ
[@kanf/wema](https://www.npmjs.com/package/@kanf/wema) の `WemaBoard` 1 つで構成されている。
**Cloudflare Workers**（Static Assets + `/api/*` の Worker）にデプロイする。

`/blog/` 配下はブログで、**別 Worker** として動く:

```
fushihara.net/*      → Worker: fushihara-net   (Custom Domain)
fushihara.net/blog*  → Worker: fushihara-blog  (Route)
```

route は Custom Domain より優先されるので、`/blog` 配下がブログ Worker に届く。

**2026-08-29 に Astro から lily（D1 を正とする自作 CMS）へ切り替え、8/30 に Astro を
消した。** `blog/` の中身は lily で、旧 `fushihara-net-blog` Worker も
`blog/content/posts/` の Markdown も無い（記事の原本は D1）。経緯と踏んだ穴は
`blog/SWITCHOVER.md`、守るべき外向きの契約は `blog/CONTRACT.md`。

**D1 と R2 の名前は `fushihara-net-lily` / `fushihara-net-lily-media` のまま。**
Worker 名だけ `fushihara-blog` に寄せた。名前を揃えるために記事と添付を引っ越す
理由がないため。

**末尾の `*` は必須。** route はクエリ文字列まで含めて URL 全体と突き合わせ、パターンに
`?` は書けないため、`*` で終わらせないとクエリ付き URL に一致しない。`/blog` と
`/blog/*` の 2 本に分けていたときは、`/blog?utm_source=...` が本体 Worker に落ちて
真っ白な 404 になっていた（本番で踏んだ）。`/blog/*` 側は末尾が `*` なので無事だった。

代償として `/blogfoo` もブログ Worker に届き、**ブログの 404 ページが出る**
（`404 | ふしはらねっとのぶろぐ`）。lily は SSR なので mount の外のパスも自分で受けて
404 を返す。Astro のころは静的アセットの `404-page` 解決に任せていて、`/blogfoo` では
本文の無い素の 404 になっていた。将来 `/blogroll` のようなパスが要るなら、より長い
route を足せばそちらが優先される。

ブログは `blog/` に独自の `package.json` / `wrangler.jsonc` / `tsconfig.json` を持つ
独立プロジェクトで、依存は本体と混ざっていない（本体の `tsc -b` にも入っていない）。
詳細は「ブログ（blog/）」節と `blog/README.md`。

リポジトリ直下の `shared/` だけが両方から読まれる（色トークン / テーマの保存キー /
日付の JST 整形 / `shared/public/` の favicon 一式）。

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
npm run db:migrate:local # ローカル D1 にマイグレーションを当てる
npm run db:seed:local    # 開発用の記事を入れる（seeds/dev.sql）
npm run build            # 静的アセット（shared/public + blog/public のコピー + 管理画面）
npm run dev              # localhost:8787。上の 3 つを先に流しておくこと
npm test                 # Vitest。実 workerd + 実 D1 で動く
npm run test:e2e         # Playwright。wrangler dev に対して回す（localhost:8788）
npm run typecheck        # wrangler types → tsc（src / e2e / 管理画面 の 3 プロジェクト）
npm run deploy           # build して wrangler deploy
```

**ビルドしていないと `wrangler` も `vitest` も動かない**（`assets.directory` が
`dist/` を指すため。`npm test` は `pretest` で自動的に走る）。管理画面は
`http://localhost:8787/blog/admin/` で、ローカルは `ACCESS_TEAM` が空なので
`localhostOnly` に落ちて開ける。

lint の設定はない。型チェックは本体側が `tsc -b` で 4 つのプロジェクト
（app / worker / test / e2e）を、ブログ側が別の `tsc` で 3 つ
（src / e2e / 管理画面）をそれぞれ見る。本体の `tsc -b` は `blog/` を含まない。

テストの外部 API は Vitest では `vi.stubGlobal('fetch')`、E2E では
`page.route()` で止めてある。CI を api.github.com のレートリミットや、
ブログ Worker（`/api/blog` の上流）の生存に依存させないため。**逆に言うと上流の
仕様変更は CI では検知できない**ので、そこは手動確認に委ねている。

`caches.default` はテスト間で生き続けるので、`test/worker.test.ts` の `call()` は
**キャッシュを 2 本とも捨ててから**呼ぶ。キャッシュが効いていることを見たいテストは
`callRaw()`（捨てない）、控えを見たいテストは `expirePrimary()`（1 時間の方だけ捨てる）
を使う。キーの導出は Worker の `cacheKeys()` をそのまま import している。テストだけ
別実装にすると、キーの決め方を変えた日に**テストが「何も検証していない」側へ倒れる**。

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

## CI とデプロイ

ワークフローは 2 本ある。本体が `.github/workflows/deploy.yml`、ブログが
`.github/workflows/deploy-blog.yml`。デプロイ先の Worker が別なので分けてある。

### 本体（deploy.yml）

main への push で動く。

- `test` は**変更の内容によらず必ず走る**（push / pull_request の両方）
- `deploy` は `changes` ジョブの判定で、**配信物に影響する変更があるときだけ**走る。
  対象は `src/` `shared/` `worker/` `index.html` `package.json`
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

`blog/**` `shared/**` と自分自身が変わったときだけ動く。テストが通れば main から
そのままデプロイする。

**マイグレーションが先、`wrangler deploy` が後。** 逆にすると、新しい列を読むコードが
古いスキーマに当たる時間ができる。裏を返すと `migrations/` は追加のみで書くという
前提で、列や表を落とすときはこの順序では守れない（そのときは 2 回に分けて出す）。

**本体の `changes` ジョブ（`deployed` タグとの差分判定）は意図的に持ち込んでいない。**
`paths` フィルタが既に「ブログに関係する変更のときだけ動く」を保証しているうえ、
ブログは毎回フルデプロイなので、テスト失敗でデプロイされずに終わった変更も次の
push で丸ごと出し直される。本体にあの仕組みが要るのは「取り残しが恒久化する」問題が
あるからで、ここに同じものを置くと `deployed` タグの衝突と複雑さだけが残る。

`shared/` を変えると本体とブログの両方のワークフローが走る（どちらの配信物にも入るため）。

**CI のトークンは「Account API Token」。** `db:migrate` が `code: 7403`（D1 への
アクセス権限なし）で落ちたとき、User API Token の一覧を見ても目当てのものが無い。
編集するのは Manage Account → API Tokens の方で、要るのは Account / D1 / Edit。

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

なお `interests` ノートは `e-interests` エッジが `collapsed: true` なので、デスクトップ
では幅 0 で畳まれた状態が正しい（中央ノートの下に出る件数バッジを**クリック**すると
開く。hover では開かない）。モバイルでは上記のとおり展開される。

**折り畳みは wema の機能のデモを兼ねているので 1 本は残す。** 畳む先が Interests
なのは、初見で必要な情報ではなく、開いたときの中身が楽しいから。以前は `email` を
畳んでいたが、**連絡先がクリックしないと出ないのは本末転倒**だったのでやめた
（バッジには件数しか出ず、そこに何があるか分からない）。

**畳む辺は 1 本のエッジが独占していないといけない。** wema の折り畳みボタンは
ノートの辺ごとに出て、**その辺のエッジが全部畳まれているときだけ件数バッジ**になる
（`s.every(e => e.collapsed)`）。他のエッジと同居していると、バッジが出ないうえに
ボタンを押すと巻き添えで畳まれる（Interests を OSS と同じ下辺に置いて実測した）。
そのため全エッジに `fromAnchor` を明示し（`auto` は座標で決まるので、ノートを動かした
拍子に同居する）、下辺は Interests 専用にしてある。左列 3 枚（Social / Skills / Links）・
右列 2 枚（Blog / OSS）という並びはこの制約から決まっている。
`e2e/render.spec.ts` の「折り畳みバッジから Interests を開ける」がこれを見張っている。

### サイトの見出し（左上）

`index.html` に直接置いた `<h1 class="site-brand">`。favicon と同じ `f.` マークと
`fushihara.net` を右上のテーマトグルと対称に固定表示する。**ボードの中（`#app`）には
置けない**。wema のサニタイザが `svg` を落とすため（トグルが外にいるのと同じ理由）。

- マークの `f` は `currentColor`（= `--text`）でテーマに追従し、丸だけ favicon と
  同じオレンジで固定する。**板は敷かない。** ライトで白い `f`、ダークで紺の `f` は
  背景に沈んで丸だけが浮く（favicon で踏んだのと同じ現象。実画面で見て決めた）
- **形（`path` の `d`）は `shared/public/favicon.svg` と `index.html` の 2 箇所にある。**
  `<use>` の外部参照は Safari が読まないので inline にせざるを得ない。片方だけ直して
  ずれないよう、`e2e/favicon.spec.ts` が両者の `d` を突き合わせている
- 見出しは `position: fixed` なので、モバイルの縦積みは `MOBILE_TOP`（56px）から始める。
  `MARGIN` のままだと 1 枚目のノートが見出しに重なる（`e2e/render.spec.ts` が矩形の
  重なりで検知する）

### 読み取り専用ロック

初期化直後はまだ編集可能で、動的データのロードが終わってから
`board.setViewOnly(true)` でロックする。`isLocked` フラグを見て
`applyLayout()` が一時的にロックを外す仕組みなので、
プログラムからノートを更新する処理はこの経路を通す必要がある。

### 動的データ（外部 API）

`src/api.ts` がフロント側のフェッチャ、`worker/` が Worker 側のプロキシ。
ブラウザから外部 API を直接叩かないのはレートリミット（GitHub）の回避、
全文入り RSS をブラウザで解析させないため（ブログ）、およびエッジキャッシュのため。

| エンドポイント | 上流 | ボードの反映先 |
|---|---|---|
| `/api/blog` | `fushihara.net/blog/posts.json` | `blog` ノート（Worker 側で JSON に均す） |
| `/api/github` | GitHub `users/:name/repos` | `oss` ノート（fork は front 側で除外） |
| `/api/github-languages` | 同上を 100 件取得 | `skills` ノート（Worker 側で言語を集計） |

#### どのリポジトリ・どの言語を見せるか

**OSS 付箋の顔ぶれは `board-data.ts` の `OSS_REPOS` が決める。** 自動で選ぶと、
`pushed` 順では star のある古い資産が全部漏れ、star 順では 10 年前の Perl ばかりに
なって「今動いている」ことが伝わらない（star 上位は共同開発のものも多い）。
API から補完するのは**説明だけ**で、star は出さない（顔ぶれを手で選んでいる以上、
数字は並びの根拠にならない）。API が落ちた日は静的テキストの名前とリンクが残る
（`test/board-data.test.ts` が静的テキストにも全部載っていることを見ている）。
**件数を増やすとカードからはみ出す**ので、`oss` ノートの `height` も一緒に見ること
（`e2e/render.spec.ts` の「付箋の中身がはみ出さない」が検知する）。

**Skills は「直近 3 年に触ったリポジトリ」だけを数える**（`SKILL_WINDOW_YEARS`）。
リポジトリ数の累積は「昔たくさん書いた言語」に引っ張られ、今の主戦場と食い違う。
あわせて `NON_LANGUAGES`（`Dockerfile` / `Shell` / `Makefile` / `HTML` / `PowerShell` 等）
を除外する。「Dockerfile が書けます」は読み手に何も伝えないため。直近に何も触って
いなければ全期間で数える（空のカードを出さないため）。

**フレームワークや道具は `board-data.ts` の `EXTRA_SKILLS` に手で書く。** GitHub の
`language` はリポジトリごとに主要 1 言語しか返さないので、Vue のように混在するものは
埋もれる。全言語を返す API はリポジトリごとに 1 リクエスト必要で（直近 3 年で 20 本
＝ 21 リクエスト）、Cloudflare の出口 IP 共有では未認証レートリミットに当たりやすく
なるため採らなかった（実際に 403 を踏んでいる）。集計結果と重複したものは `main.ts`
が落とす。**行が増えると `skills` ノートからはみ出す**ので `height` も一緒に見ること。

- `worker/index.ts` — ルータ。`caches.default` の参照と `ctx.waitUntil` での書き込みを
  一箇所に集約しているので、**個々のハンドラはキャッシュを意識しない**
- `worker/api.ts` — 3 ハンドラ。`githubRepos` は上流をそのまま流すだけなので
  `proxy()` に寄せてある

`loadDynamicData()` は `Promise.allSettled` なので、どれか失敗しても
`board-data.ts` の静的テキストがそのまま残る。

- `src/note-html.ts` — ノートの text を組み立てる小物（`escapeHtml` / `moreLink`）。
  `board-data.ts` と `main.ts` の両方から使う。DOM に触れないのでテストから読める
- Blog 付箋の日付は **`shared/date.ts` の `isoDate()`**。ブログ本体の記事日付と
  同じ関数なので、`/` と `/blog/` で同じ記事の日付がずれない
  （JST 固定にしている理由はそのファイルの doc comment）

#### 上流が落ちたときの控え

`worker/index.ts` はキャッシュのキーを 2 本持つ。通常の 1 時間のものと、成功した
レスポンスだけを 30 日残す `/__backup/<path>`。上流が失敗したら控えを
`X-Backup: hit` を付けて返し、カードが「Loading...」に戻るのを防ぐ。GitHub の未認証
レートリミットは Cloudflare の出口 IP 共有で割と簡単に枯れるため。

- **どちらのキーも `cacheKeys()` が組み、そのエンドポイントが解釈するクエリしか
  見ない**（`ROUTES` の `keyParams`）。`?utm_source=…` でキーが割れると、中身が同じ
  でも毎回上流を叩き、控えで守りたかったレートリミットをそこで消費する。
  **ハンドラが読むクエリを増やしたら `keyParams` にも足すこと**（漏れると別々の
  リクエストが 1 つのキャッシュを共有する）
- 控えを返すときの `Cache-Control` は 5 分。1 時間持たせると上流が復旧しても
  ブラウザ側に古いカードが残る
- 控えが無ければ上流のエラーをそのまま返す（ボードは静的テキストのまま残る）
- **200 でも中身を取り出せなかったら非 ok を返すこと。** 空のレスポンスを 30 日
  控えに書くと、上流が直っても付箋が「Loading...」で固定される
  （`/api/blog` が記事 0 件を 502 にしているのはこのため）

`caches.default` はデータセンター単位で、追い出されることもある。全世界で確実に
残す必要が出たら KV に移す。

#### `/api/blog` が読むもの

**ブログの `posts.json`。** lily が本体サイトのために生やしている口で、
`{ id, title, url, published_at, description, tags }` を返す。`/api/blog` は
そこから `{ title, link, date }` だけを取り出す（**知らないキーは見ない**ので、
ブログ側が列を増やしても本体は壊れない）。

`count` はそのまま `posts.json` の `limit` に渡す（既定 5・上限 20 で同じ形）。
**上流が `limit` を無視しても本体側で絞る。**

Astro だった頃は RSS を正規表現で読んでいた。生成側が本文を CDATA ではなく実体参照で
書くので item の切れ目を偽装できない、という前提に乗った実装で、**生成器を替えたら
崩れる**ものだった。専用の口ができたのでその前提ごと消えている。

取り出せた記事が 0 件なら 502 を返して**前回の控えで凌ぐ**（上の「上流が落ちたときの
控え」参照）。

##### 取りに行き方（同一ゾーンの罠）

**素の `fetch('https://fushihara.net/blog/posts.json')` で取ってはいけない。**
Worker から同一ゾーンの URL へのサブリクエストは、**その Worker ルートを再実行せず
origin へ向かう**。このゾーンに origin は無いので 522（接続タイムアウト）になる。
本番で踏んだ。**ローカル dev は素の外向き fetch なので、これを一切再現しない。**

そのため `wrangler.jsonc` の `services`（`BLOG` → `fushihara-net-lily`）でブログ
Worker を直接呼ぶ。ローカルにはそのセッションが無く binding は 503 しか返さないので、
`worker/api.ts` の `isLocal()` が `localhost` / `127.0.0.1` のときだけ公開 URL への
素の fetch に切り替える（同一ゾーンの制限は本番のエッジの話なので、ローカルからは
普通に読める）。両方の経路は `test/worker.test.ts` で固定してある。

service binding はテストのプールにも存在しないので、`vitest.config.ts` の
`miniflare.serviceBindings` でスタブに差し替えている（無いと workerd が起動時に
落ちてテストが 1 つも動かない）。

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
`blog/` は独立プロジェクトなので、この `references` には入らない（あちらの `tsc` が見る）。

`worker-configuration.d.ts` は `wrangler types` の生成物（`Env` とランタイム型）で
git 管理外。`wrangler.jsonc` を変えたら再生成が要る（`npm run build` が毎回走らせる）。

### テーマ（ライト / ダーク）

色は **すべて `shared/tokens.css` の CSS カスタムプロパティ**に集約してある。
本体サイト（`src/style.css`）とブログ（`blog/src/site/blog.css`）が両方これを
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
- `src/theme-toggle.ts` / `blog/src/site/client.ts` — 各サイトの DOM 側。
  ボタンの作り方が違う（本体は JS で生成、ブログは配信する HTML にあるものを拾う）ので
  分かれている。OS 設定に追従するかどうかは保存値ではなく `chosen` フラグで判定する。
  `getItem` は通るのに `setItem` だけ throw する環境（Safari プライベートモード /
  QuotaExceededError）で、保存に失敗したユーザーの選択を OS 側の変更に奪われないため
- `index.html` の `<head>` にある同期スクリプトが、保存値を**描画前に** `data-theme` へ
  stamp する。モジュールスクリプトは defer なので、これが無いとちらつく。
  `STORAGE_KEY` の文字列をここに直書きしているので、変えるときは両方直す
  （ブログ側は `site/layout.ts` が `shared/theme.ts` から埋め込むので直書きしていない）

### favicon

実体は **`shared/public/`** に置き、本体は `vite.config.ts` の `publicDir` がそこを
向き、ブログは `blog/scripts/build.mjs` が `dist/` へコピーする。同じアイコンを
2 箇所に置くと必ず片方だけ古くなるため。ブログ側の参照は `/blog/favicon.svg` のように
mount 付きになり、`<mount>/favicon.svg` への要求を Worker が binding 経由で読み替える
（配るものの一覧は `core/routes/fixed.ts` の `STATIC_ASSETS`）。

**片方のサイトだけの静的ファイルが要るようになったら、置き場所を分けること。**
`shared/public/` に置いたものは両サイトに配られる。ブログ側はコピーなので
`build.mjs` で選べるが、本体は `publicDir` を丸ごと向けているので選べない。
`robots.txt` のように「本体だけ」に効かせたいものが出たら、本体に `public/` を戻して
共有物をビルド前にコピーする形へ寄せる。

3 つとも同じマークと配色（紺 `#1A1A2E` の板に白い `f` とオレンジ `#FF6B00` の丸）。
**違うのは角だけ。**

| ファイル | 角 | 用途 |
|---|---|---|
| `favicon.svg` | 角丸 `rx=10`（64 基準） | SVG に対応するブラウザ |
| `favicon.ico` | 同上 | 32x32。非対応ブラウザと素の `/favicon.ico` 要求 |
| `apple-touch-icon.png` | **ベタの正方形** | 180x180。iOS のホーム画面など |

`apple-touch-icon.png` だけ角を丸めないのは、iOS が自分でマスクをかけるため。
こちらで丸めると二重に丸まるうえ、角に空いた透明部分を黒く塗られる。

- 元絵は旧サイト（`kan/www.fushihara.net` の `dist/img/favicon.png`）の "f."。
  145px の PNG からアウトラインを起こしてある。丸だけ赤からオレンジに変えた
- **link タグは `.ico` を先に書く。** SVG に対応するブラウザはそちらを選ぶ
- **3 つとも不透明の板を敷く。テーマ追従はしない。**
  最初は `favicon.svg` だけ背景透明にして、`@media (prefers-color-scheme)` で
  `f` の色を切り替えていた。**本番で「オレンジの丸しか見えない」状態になった。**
  `prefers-color-scheme` は OS の設定であって、ブラウザのタブバーの明るさとは別物
  だから。OS がダーク・ウィンドウがライトだと、白い `f` が明るいタブバーに乗って消える。
  そもそも favicon の SVG からは `localStorage` を読めないので、テーマトグルで
  明示的に選んだ側にも追従できない。追従は最初から半分しか届いていなかった。
  ついでに `apple-touch-icon.png` は透明にできない（iOS がホーム画面で透明部分を
  黒く塗る）ので、板を敷けば 3 ファイルの配色が揃い、`shared/tokens.css` との
  色の重複も消える。**透過に戻さないこと。** `e2e/favicon.spec.ts` が見張っている
- ラスタ 2 つは `favicon.svg` を headless Chrome で書き出し、`sharp` で 16 色
  パレットに落として作った（実質 2 色の絵なので、フルカラーのままだと 2.4KB、
  パレット化すると 0.9KB）。`.ico` は 32x32 の PNG を ICO コンテナに 1 枚だけ
  入れたもの。作り直すときは旧サイトの PNG ではなく `favicon.svg` を流用する。
  **`apple-touch-icon.png` は `rx` を外して書き出すこと**（上表のとおり、
  ここだけベタの正方形）
- **`favicon.svg` のコメントにハイフン 2 個を書かないこと。** SVG は XML なので
  `<!-- ... --text ... -->` は不正になり、ファイル全体がパースエラーになる
  （CSS 変数名を裸で書いて実際に踏んだ）。壊れていても 200 で配信されるので、
  ブラウザのタブに何も出なくなるまで気付けない
- 配線は壊れても画面に出ないので、link タグと実体（200 / 空でないこと / SVG が
  パースできること）を E2E で突き合わせている
  （本体は `e2e/favicon.spec.ts`、ブログは `blog/e2e/blog.spec.ts` の「配信物」節）。
  透過とテーマ追従に戻していないかは、**実際に描画した画素**で見ている。OS 設定を
  ライト / ダークに振って、板が不透明で `f` が板と 4.5:1 以上のコントラストを持つこと。
  ソースの文字列で検査すると `light-dark()` で書き直された形をすり抜ける。
  実体の検証に `<img>` のデコードを使ってはいけない。`page.route()` を張った状態だと
  **ICO だけデコードに失敗する**（Playwright の傍受の副作用で、ファイルは壊れていない）

### OGP の絵は 2 枚（本体とブログ）

**`ogp.png`（1200x630）だけはサイトごとに別**（favicon 3 点は共有のまま）。

| ファイル | 出るところ | 中身 |
|---|---|---|
| `shared/public/ogp.png` | 本体（`/ogp.png`） | `f.` マーク + `fushihara.net` |
| `blog/public/ogp.png` | ブログ（`/blog/ogp.png`） | `f.` マーク + 「ふしはらねっとのぶろぐ」 |

最初は共有の 1 枚を両方が使っていたが、**どちらのリンクを貼っても同じ絵が出る**ので
分けた。`blog/scripts/build.mjs` は共有（favicon 3 点）を先にコピーしてから
`blog/public` を被せるので、**同じ名前があればブログ側が勝つ**。順序を入れ替えると
本体の絵が黙って配られる（`blog/e2e/blog.spec.ts` の「配信物」節がバイト列で見張る）。

**`og:image` は絶対 URL でないとクローラが解決できない**ので、本体は `index.html` に
直書き、ブログは `core/paths.ts` の `urls.asset(…, { absolute: true })` で組み立てる。
配線が切れても画面には出ないので、本体は `e2e/favicon.spec.ts`、ブログは
`blog/e2e/blog.spec.ts` の「配信物」節が meta と実体を突き合わせている。

**ブログの記事は添付から 1 枚を選んで上書きできる**（管理画面の「OGP に使う」。
Bluesky のリンクカードにも同じ絵が出る）。詳細は `blog/README.md` の「OGP の絵」。

作り直すときは `f.` マークと文字を並べた HTML を headless Chrome で 1200x630 に撮り、
`sharp` の 64 色パレットに落とす（本体 18KB → 4.8KB、ブログ 34KB → 13KB）。
ブログ側の見出しは配信しているのと同じ Noto Sans JP。

### SNS アカウントの宣言（`rel="me"`）

`<head>` に `<link rel="me">` を並べて「このリンク先は自分だ」と宣言している。
URL は **`src/board-data.ts` の `SOCIAL_LINKS` が正**で、Social 付箋のアイコンと
`<head>` の両方がそこから出る。

- **差し込みは `vite.config.ts` のプラグイン（ビルド時）。** 出す値はリクエストに
  依らないので Worker を通す理由が無い。通すと `run_worker_first` に `/` を足す
  ことになり、トップページが毎回 Worker を経由して ETag と 304 を自前で扱う羽目になる
- **読むのは Mastodon**（相互リンクを見て検証マークを付ける）。**X も Bluesky も
  読まない。** 宣言としては正しいが、消費者は限られる
- Bluesky には `twitter:site` に当たる meta が無い。リンクカードは `og:*` だけを見る。
  そのかわりハンドル自体がドメイン（`kan.fushihara.net`）で、`_atproto` の TXT
  レコードが持ち主の証明になっているので、**サイト側に足すものが無い**
- 付箋と `<head>` がずれていないかは `e2e/render.spec.ts` が実際に配信された HTML で
  突き合わせる。`rel="me"` は相互リンクで初めて意味を持つので、URL が 1 文字違うと
  黙って効かなくなる

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

**`/blog` を配っているのは `blog/`。** D1 を正とする自作 CMS（**lily**）で、
2026-08-29 に Astro から切り替え、8/30 に Astro を消して `lily/` をここへ改名した。
設計の正本は [issue #5](https://github.com/kan/fushihara.net/issues/5)、現状は
`blog/README.md`、**守るべき外向きの契約は `blog/CONTRACT.md`**、配線を動かす手順と
踏んだ穴は `blog/SWITCHOVER.md`。

**独立したプロジェクト。** 自分の `package.json` / `wrangler.jsonc` / `tsconfig.json`
を持ち、本体の `tsc -b` にも入っていない。共有しているのは `shared/` だけ。

**記事はリポジトリに無い。** 原本は D1 で、書くのは管理画面（`/blog/admin/`）。
だから「記事を書く」だけならコミットも push も発生しない。Astro のころ
`blog/content/posts/` にあった Markdown は `git show 1361402:blog/content/posts/…`
で読める。

- **mount は `src/site/meta.ts` の `MOUNT_PATH` 1 行。** ユニットテストも E2E も
  そこから引くので、mount を動かしても spec を書き換えずに済む
- **`.dev.vars` が Access の設定をローカルだけ打ち消す。** 本番の値は
  `wrangler.jsonc` の `vars`。vitest のプールも `.dev.vars` を読むので、
  テストから見える `ACCESS_TEAM` は空になる
- **route を書くと `wrangler dev` のリクエスト host が実ドメインになる。**
  `localhostOnly` が効かなくなるので `"dev": { "host": "localhost" }` で戻す
- テストは実 workerd + 実 D1 で動く。**D1 の制約は生 SQL で叩いて確かめる**
  （query layer 越しに見ても、制約が効いているかの検証にならない）
- `wrangler` を叩くときは `-c ./wrangler.jsonc` が要る（リポジトリ直下に本体の
  `.wrangler/deploy/config.json` があると、どちらの設定か分からず落ちる）
- **記事の出し入れは portable な zip（`blog/src/core/transfer/`）。** 形は
  `posts/<canonical>/index.md` + 添付で、Astro 版の frontmatter がそのまま読める。
  よそから記事を持ち込むときもこの経路を通す（`CONTRACT.md`）
- **Worker 名は `fushihara-blog`、D1 と R2 は `fushihara-net-lily` 系のまま。**
  名前を揃えるために記事と添付を引っ越す理由がないため
