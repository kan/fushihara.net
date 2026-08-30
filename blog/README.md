# blog（lily）

`fushihara.net/blog` を配っている、D1 を正とする自作 CMS。中身の名前は **lily** で、
`src/core/` は将来 OSS として切り出す。まずこのリポジトリ内の Worker として動かしている。

Worker 名は `fushihara-blog`、ディレクトリは `blog/`、コアの名前が `lily`。
**D1（`fushihara-net-lily`）と R2（`fushihara-net-lily-media`）だけ古い名前のまま**で、
これは改名が中身の引っ越しになるため（名前を揃えるために記事と添付を移す理由はない）。

設計の全体像と決定事項は
[issue #5](https://github.com/kan/fushihara.net/issues/5) が正本。守るべき外向きの
契約（URL・フィード・記事の出し入れの形）は [`CONTRACT.md`](./CONTRACT.md)。

## 今できていること

- D1 のスキーマとマイグレーション（`STRICT` / `CHECK` / index）
- `src/core/db/` の query layer（記事・パス・添付・タグ）
- `src/core/paths.ts`（`mountPath` と URL 生成、`normalizePostPath`、予約パス）
- `src/core/render/`（CommonMark + GFM、Shiki、相対参照 → placeholder）
- 公開側の SSR（一覧・記事・タグ・404・alias 308・下書きプレビュー）と CSS の移植
- フィード（RSS 維持 + Atom 追加）、sitemap、favicon / ogp の配信
- 添付の配信（R2 が原本、Cloudflare Images は任意の最適化層）と、
  `<img>` の `width` / `height` / `loading` / `decoding`
- `AuthAdapter` と Cloudflare Access アダプタ、`<mount>/api/*` と
  `<mount>/admin/*` の保護境界
- 管理 API（記事の CRUD・公開/取り下げ・パス変更・プレビュー URL・添付・再描画）
- portable な import / export（Markdown 一式の zip。往復で identity と URL が保たれる）
- `posts.json`（本体サイトの Blog 付箋が読む口）
- E2E（`e2e/`。フィクスチャは import で入れる）
- Vue の管理画面（一覧・編集・プレビュー・画像 D&D・パス変更・プレビュー URL・
  公開日時・タグ補完・ページング・タグ / キーワードでの絞り込み・設定の確認・
  セッション切れからの復帰）
- 説明（description）の自動生成。手で書いていなければ本文の冒頭を配信時に出す
- 毎日の控え取り（Cron Trigger → portable な zip を別の R2 バケットへ 30 世代）
- 公開ページの管理リンク（管理画面を開いたことがある端末にだけ出る）

**2026-08-29 に `/blog` を Astro から引き継いだ。** 2026-08-30 に Astro
（`blog/` と `fushihara-net-blog` Worker）を消し、`lily/` をこの `blog/` に改名した。
経緯と踏んだ穴は [`SWITCHOVER.md`](./SWITCHOVER.md)。

## コマンド

```bash
npm install
npm test                 # Vitest。実 workerd + 実 D1 で動く
npm run test:e2e         # Playwright。wrangler dev に対して回す (localhost:8788)
npm run typecheck        # wrangler types → tsc (src / e2e / 管理画面 の 3 プロジェクト)
npm run db:migrate:local # ローカル D1 にマイグレーションを当てる
npm run db:seed:local    # 開発用の記事を入れる（seeds/dev.sql）
npm run build            # 静的アセット（shared/public のコピー + 管理画面）
npm run dev              # localhost:8787。上の 3 つを先に流しておくこと
```

`wrangler.jsonc` の `assets.directory` が `dist/` を指すので、**ビルドしていないと
`wrangler` も `vitest` も動かない**（`npm test` は `pretest` で自動的に走る。
`npx vitest run` を直に叩くときは先に `npm run build`）。

管理画面は `http://localhost:8787/blog/admin/`。ローカルでは
`ACCESS_TEAM` が空なので `localhostOnly` アダプタに落ちて開ける。

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
    api/      管理 API。mount を知らない形で <mount>/api にマウントされる
    auth/     AuthAdapter の型と Cloudflare Access アダプタ
    feed/     RSS 2.0 と Atom。どちらも全文
    media/    画像の最適化（任意）、受け付ける形式の表、寸法をヘッダから読む
    render/   Markdown → HTML。保存する側と配信する側で 2 段に分ける
    transfer/ portable な import / export。frontmatter・zip・往復の規則
    routes/   fixed.ts がルーティング定義の正本。public.ts が人向け、
              feeds.ts が機械向け、media.ts が添付、api.ts が保護境界
    theme.ts  テーマが実装する型。core は HTML を 1 バイトも持たない
  site/       fushihara.net 固有（レイアウト・CSS・文言・OGP・クライアント JS）
    meta.ts   mount とサイト名。**何も import しない**（E2E が Node から読む）
  admin/      Vue の管理画面。別ビルド（vite）で dist/admin に出る
  config.ts   サイト設定。createLily() に渡す
test/         Vitest
e2e/          Playwright。fixtures/ を import で入れて wrangler dev に対して回す
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
変えても `body_html` の再生成が要らない**（並走していたころ、`/blog-next` と
`/blog` が同じ D1 を見て同時に正しい URL を出せた）。

- **`rehype-raw` は使わない。** HTML を parse5 で読み直すので、表の中の改行が
  foster parenting で表の外へ追い出される（`</pre>` と `<table>` の間に空行が
  14 行並ぶ）。生 HTML は raw ノードのまま最後まで運ぶ
- **Shiki は `defaultColor: false` を維持する。** 色を直接書かせず
  `--shiki-light` / `--shiki-dark` だけを出させて CSS の `light-dark()` に渡す。
  `'light'` にすると `!important` が要るようになる
- 載せる言語は `render/highlighter.ts` の `LANGS`。**バンドルに入る**ので、
  書かない言語は入れない（Worker 全体は gzip 約 410 KiB で、その大半がこれ）。
  測るときは `npx wrangler deploy -c ./wrangler.jsonc --dry-run` の Total Upload
- Astro は `pre.astro-code` を出していたが、Shiki 素のクラス名は `pre.shiki`。
  CSS を移植するときに読み替えること

### `<img>` の属性

Markdown の画像記法から出た `<img>` には `width` / `height` / `loading="lazy"` /
`decoding="async"` を付ける。**`width` / `height` が無いと、画像が届くまで高さが
0 のままで本文が飛ぶ**（Astro 版からの唯一の機能的な後退だった）。

寸法は**画像そのものの性質で deployment に依存しない**ので、保存する `body_html`
に焼き込んでよい（配信時に解決されるのは URL だけ）。読むのは
**アップロードと import の時点**で、`core/media/dimensions.ts` がヘッダから取る。

- **EXIF の orientation を見る。** 5〜8 は縦横を入れ替えて描かれる（ブラウザの
  `image-orientation` は既定で `from-image`）。格納値をそのまま書くと、スマホで撮った
  縦写真に**横長の枠を予約してから縦長で描き直す**ことになり、防ぎたかったレイアウト
  シフトが却って大きくなる。EXIF を持てる 3 形式（JPEG の APP1 / PNG の `eXIf` /
  WebP の `EXIF` チャンク）すべてで見る
- **書くのは Markdown の画像記法から出た `<img>` だけ。** 記事に直接書いた生 HTML は
  属性を著者が決めているので、URL の解決以外は触らない
- `width` と `height` は**揃っているときだけ**足す。片方だけ書かれているところへ
  もう片方を入れると、著者の指定と違う比率に潰れる
- **寸法が読めなくても添付は受け付ける**（属性が出ないだけ）。AVIF は読まない。
  寸法は `ispe` にあるが、どれが本体のものかは `pitm` と `ipma` を辿らないと
  決まらず（サムネイルやアルファの補助画像にも付く）、実物で検証する手段が
  手元に無いため
- **`viewBox` しか無い SVG はその比を寸法として使う。** `<img>` に置いた
  viewBox-only の SVG は固有サイズを持たないので、属性が無いと既定の 300px 幅に
  伸びる。`viewBox="0 0 24 24"` のアイコンは 24px で出るようになる。これは
  Astro（sharp）が書いていた値と同じ
- **属性を出すと `<img>` は読み込み前から箱を持つ。** E2E で「描画された」と
  「読み込めた」を同じもので見ていると通り抜ける（`naturalWidth` は
  `expect.poll` で待つ）
- **既存の添付には遡らない。** 寸法は `createMedia()` の INSERT でしか入らないので、
  この変更より前に上げた添付は `width` / `height` が NULL のまま。`/api/rerender` は
  `body_html` を作り直すだけで埋めない。埋めたければ**入れ直すか再 import する**
  （まだ配信していないので、実害があるのは手元の D1 だけ）

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
| 画像記法の組み立て・リンクの URL 欄の判定 | `core/render/markdown.ts` |
| 説明を本文から作る規則 | `core/summary.ts` |
| 添付の R2 キーの決め方 | `core/db/media.ts` の `mediaR2Key` |
| 添付として受け付ける形式（判断の材料ごと） | `core/media/formats.ts` |
| 添付の寸法をヘッダから読む規則 | `core/media/dimensions.ts` |
| portable な形式（frontmatter のキーと並び） | `core/transfer/format.ts` |
| その形式の YAML をどこまで読むか | `core/transfer/frontmatter.ts` |
| 日時の JST 変換 | `shared/date.ts` |
| 見た目・文言・OGP（差し替え点） | `core/theme.ts` の `Theme` を `site/` が実装 |
| キャッシュ方針 | `core/routes/cache.ts` |
| 保存済み HTML と描画の使い分け | `core/delivery.ts` |
| 開始タグの中の `src` / `href` の書き換え | `core/render/html.ts` の `rewriteUrlAttributes` |
| D1 のバインドパラメータ上限（100）への対処 | `core/db/chunk.ts` |
| 管理画面と配信側の契約（meta の名前・目印の cookie） | `core/admin-contract.ts` |
| 管理画面のハッシュ URL の形 | `core/paths.ts` の `ADMIN_HASH` |
| 一覧の絞り込み条件（行と件数で同じもの） | `core/db/posts.ts` の `postFilter` |
| 控えの置き場所と世代の切り方 | `core/backup.ts` |

## 説明（description）

一覧・OGP・RSS / Atom・`posts.json` に出る短い説明。**手で書いていなければ本文の
冒頭から作る**（`core/summary.ts`）。

- **DB には保存しない。** 配信のたびに `body_md` から組み直すので、本文を直せば
  そのまま追従する。保存すると、本文を書き換えた記事の説明だけが古いまま残る
- 出す側は全部 `postDescription()` を通す（view model・フィード・`posts.json`）。
  1 つでも素の `description` を読むと、そこだけ空になる
- 取るのは**最初の段落 1 つだけ**。段落をまたいで繋ぐと、元の文章に無い並びの文が
  OGP に出る。書き出しが説明にならない記事は手で書けばよい（手書きが常に勝つ）
- **読むのは renderer と同じパーサ**（remark + remark-gfm を `parse` まで）。
  記法を正規表現で読み直すと書き方ごとに取りこぼしが出て、同じ本文から出る OGP と
  記事本文が食い違う（setext 見出しの下線が説明に漏れ、`- - -` が `-` という説明に
  なった）。mdast まで読めば「段落とは何か」はパーサが決める。HTML を作る段
  （remark-rehype と Shiki）は通さないので、増える仕事は解析だけ
- **管理画面はこれを import しない。** 説明欄の placeholder に出す控えは
  `POST /api/render` が本文の HTML と一緒に返す。解析器をブラウザのバンドルへ
  運ばずに済み、打鍵ごとではなくプレビューと同じ 300ms の間引きに乗る
- 行を繋ぐとき、日本語のあいだには空白を入れない（CommonMark の softbreak は
  空白扱いだが、折り返して書いた日本語に空白が挟まると語の途中が割れて見える）。
  箇条書きの項目だけは別で、繋げると隣の項目と 1 つの文に見えるので必ず空ける

## フィード

- **`content:encoded` は CDATA ではなく実体参照で書く。** 本体サイトの
  `/api/blog` が正規表現で RSS を読んでいて、CDATA を吐いた瞬間に壊れる。
  本体を `posts.json` へ移すまでは変えないこと
- 本文の URL はすべて**絶対**にする。リーダーは記事の URL を起点に相対 URL を
  解決してくれない
- 色は要素に直接書く。リーダーはこのブログの CSS を読まないので、Shiki の
  `--shiki-*` はライト側の値に展開する
- **RSS の `guid` は記事の URL のまま。** `urn:uuid:` に変えると、既存の
  購読者全員に全記事が「新着」として配り直される。Atom は新設なので
  `urn:uuid:<public_id>` を使える（パスを変えても同じ記事として扱われる）

## 認証

`<mount>/api/*` と `<mount>/admin/*` は `AuthAdapter` を通らないと届かない。
**中身が無いうちから掛けてある**ので、route を足したときに保護を忘れる余地がない。

- ローカルでは `localhostOnly` に落ちる。**本番は開けない**（host が
  `localhost` / `127.0.0.1` 以外なら必ず拒否する。Cloudflare は host で
  ルーティングするので、実ドメインに来た要求がこの条件を満たすことはない）
- **core は認証の方式を 1 つも知らない。** fushihara.net は Cloudflare Access
  アダプタを使うが、Deploy to Cloudflare は Access を自動プロビジョニングできない
  ので、OSS の標準構成では別のアダプタが既定になる
- Access は Worker の手前でリクエストを止めるので、**ここでの検証は二重の守り**。
  Access を経由しない経路（route の設定漏れ・別ドメインからの直接アクセス）で
  管理画面が開かないようにするためのもの
- チーム名と AUD は `wrangler.jsonc` の `vars`。秘密ではないが deployment ごとに
  違うのでコードに焼き付けない。**両方揃ったときだけ** Access を使い、片方でも
  欠けていれば `localhostOnly` に落ちる（＝本番では開かない）。片方だけ設定して
  「Access で守られているつもり」になるのが一番危ないので、判定は `authMode()`
  1 箇所に置き、**選んだ方を起動時に 1 度だけログへ出す**
- 拒否した理由はレスポンスに載せない。どこまで合っていたかは、当てにいく手掛かりになる
- **JWT が切れたあとの API は 403 を返し続ける。** 画面から直す手立ては
  トップレベルのナビゲーションで Access に通り直すことだけなので、管理画面が
  401 / 403 を見たら読み込み直す（`src/admin/session.ts`）。詳細は「管理画面」の
  「セッションが切れたとき」
- **セッションの長さは Access 側の設定**（Zero Trust → Access → Applications →
  当該アプリの Session Duration）で、リポジトリからは変えられない。`wrangler.jsonc`
  の `vars` にあるのはチーム名と AUD だけ
- **認証だけでは足りない。** Access の `CF_Authorization` は Cookie なので、
  他所のサイトから送られたリクエストにも付いて回る。body を読まない口
  （`unpublish` / `rerender`）と multipart の口（`media`）は素のフォームから
  叩けるので、`csrf()` で Origin を見る

## 管理 API

リクエストの検証は zod を `zValidator` で **1 度だけ**書き、レスポンスの型は
handler から推論させる（Hono RPC）。手で書いた型と実装がずれる余地を作らない。

```ts
import { hc } from 'hono/client';
import type { LilyApi } from './core/api/index.ts';

const client = hc<LilyApi>('/blog/api');
const res = await client.posts.$post({ json: { title: '…' } });
if (!res.ok) { /* 400 / 404 / 409 */ }
const { post } = await res.json();  // 型は handler から
```

- **route のパスは mount を知らない。** `<mount>/api` にマウントされるので、
  リテラルのまま型に残り、`hc` が `client.posts` の形を作れる
- **エラーのステータスは `400 | 404 | 409` に絞る。** 広い型にすると
  `if (res.ok)` の絞り込みが効かなくなる
- **本文が変わる操作のときだけ `body_html` を描き直す。** 配信側が毎回描き直さずに
  済む。`GET` は書き込まない（一覧→詳細を開くだけで D1 に書くことになる）。
  添付を消したときも描き直す（消えた画像を指す `<img>` を公開ページに残さない）
- **`POST /api/rerender` は今の renderer で描かれていない記事だけ**を、1 回
  あたり 50 件まで処理して `remaining` を返す。Workers の subrequest には上限が
  あるので、黙って打ち切ると「成功したのに古いままの記事」が残る
- 添付は **DB に行を入れてから R2 に置く。** `r2_key` は（記事, ファイル名）から
  決まるので、逆順にすると 2 回目の upload が既存の実体を上書きしてから 409 を
  返すことになる（「失敗した」と言いながら元の画像は消えている）
- タグは**記事を作る前に検証する。** 作ってから弾くと、失敗を返したのに記事だけ
  残り、同じパスで作り直すと 409 になって手詰まりになる
- プレビューの**生のトークンを返すのは発行のときだけ**。DB に入るのは SHA-256 の
  ハッシュで、記事の詳細には `hasPreview` しか出ない
- 添付は**拡張子で形式を決める**。ファイル名は記事のパスと同じ `normalizeSegment` を
  通す（export でそのままディレクトリに書き出すため）。ブラウザの `Content-Type`
  だけで通すと、**上げられるのに取り込み直せない添付**ができる（書庫に
  Content-Type は無いので、import 側は拡張子しか見られない）
- `POST /api/link-title` は**外から来た URL をそのまま fetch する口**。
  http/https だけ・IP リテラルとローカル向けの名前を弾く・**リダイレクトを自分で
  追って飛び先も毎回検査する**・5 秒で打ち切る・先頭 64KB だけ読む、で狭めてある
  （`redirect: 'follow'` に任せると最初の 1 回しか検査されず、公開 URL から
  内側へ飛ばされる）

## 管理画面

`<mount>/admin/`。Vue の SPA で、Worker とは別のビルド（`vite build`）。

- **`base: './'` と、mount をパスから割り出す。** 同じ成果物が `/blog` でも
  別の mount でも動く（deployment の設定をビルドに焼き付けない）
- **プレビューは `POST /api/render`。** 公開ページと同じ renderer を通すので、
  書きながら見ているものと出るものが食い違わない。管理画面に Markdown の
  パーサを 2 本目として持ち込まずに済む
- 画像は D&D か貼り付けで上がり、本文に入るのは `./<filename>` の相対参照。
  配信 URL は描画時に解決する
- `hc` の戻り値は成功・API のエラー・zod の検証失敗の union なので、
  **絞り込みをまたぐ汎用ヘルパーを作らない**（型が消える）
- クライアントの base は**絶対 URL**。`$url()` が URL を組むのに要る
  （相対だと画像のアップロードが `Invalid URL` で落ちる）
- **日時の入力はネイティブの `datetime-local` / `date` を使わない。** 日本語の
  Chrome では曜日の欄が付いた形（`2026/08/28(金) 00:25`）で描かれ、そこが空の
  まま出る。環境によって出方が変わるものを画面に置くと、崩れても手が出せない
- **アップロードのあとに記事を読み直さない。** textarea の value を代入し直すと
  カーソルが末尾へ飛び、画像がそこに入る（増えたのは添付だけなので 1 件足す）
- **公開日時は触ったときだけ送る。** 欄は分までしか持たないので、読み込んだ値を
  そのまま送り返すと秒が落ちる。一覧とフィードの並びは `published_at DESC` なので、
  無関係な編集で同じ分に公開した記事の順序が入れ替わる
- **タグの候補は選んだあとも閉じない。** 候補は `mousedown.prevent` で拾っていて
  blur が起きないので、閉じると 2 つ目を選ぶのに一度どこかへ外して戻る必要が出る
  （`focus()` は既に当たっている入力欄には focus イベントを出さない）
- **リンクの URL 欄に貼った URL は展開しない。** 貼り付けた URL は普段
  `[題](url)` に包むが、`[題](` の続きに貼ると `[題]([url](url))` になる。
  どこが URL 欄かの判定（`inLinkUrl`）は記法の知識なので core 側に置いてある
- **SPA の fallback から `assets/` を外してある。** ハッシュ付きのバンドルが
  無いときに `index.html` を 200 で返すと、古いタブが JS の代わりに HTML を
  受け取って構文エラーで固まる（404 なら再読み込みで直る）

### セッションが切れたとき

Access の JWT には期限がある。切れたあとの呼び出しは 403 で返り、画面には
「forbidden」とだけ出る。**押し直しても直らない**ので、`src/admin/session.ts` が
1 箇所で受けて読み込み直す。

- **読み込み直す前に書きかけを sessionStorage へ退避し、戻ってきたら復元する。**
  保存前の本文はそこにしか無い（記事の正は D1 で、これは事故のときだけ使う控え）
- **直前にも読み込み直していたら何もしない。** リロードで直らない拒否（AUD の
  設定違い等）だと、そのまま無限に読み込み直すことになる。そのときは 403 の
  エラーがそのまま画面に出る
- **開いていた画面も退避する。** Access のログインを経由すると `#` はサーバーへ
  送られないので、戻ってきた URL は `<mount>/admin/` になる（`router.ts` の
  `openingHash()` が寄せ直す）
- 画像のアップロードは `hc` を通らない multipart だが、**同じ `apiFetch` を使う**。
  片方だけ素の `fetch` だと、そこで切れたときに気付けない

### サイト設定は配信時に差し込む

題（`<title>`）と見出しは `lily` ではなく**サイト名**にしてある。管理画面を
複数開いたときに、タブが全部 `lily` だと見分けが付かないため。

差し込むのは `core/routes/admin.ts` で、入口 HTML を HTMLRewriter に通して
`<title>` を `<サイト名> - lily` にし、`<meta name="lily:site">` の `content` に
設定を JSON で入れる。読む側は `src/admin/site.ts`。

- **ビルド時に焼かない。** `base: './'` と mount の割り出しと同じ理由で、同じ
  成果物をどこにマウントしても使えるようにするため。焼くと mount ごと・サイト
  ごとにビルドが要る
- **載せるのは `SiteConfig` そのもの。** 項目を選び直すと、設定に足したものが
  設定画面に届かず、しかも型は通るので「設定画面にだけ出ない」で終わる
- **mount は運ばない。** 管理画面は自分がどこに配られたかを `src/admin/api.ts` の
  `MOUNT` で割り出していて、API のベース URL もそれで組んでいる
- meta の名前と目印の cookie は `core/admin-contract.ts` に置く。**管理画面は
  vite で別にバンドルされる**ので、route のモジュールから値を import すると
  hono ごとブラウザ側へ運ぶことになる（型だけなら消えるが、値は残る）
- 受け皿の `<meta>` は `src/admin/index.html` に空で置いてある。属性値の
  エスケープは HTMLRewriter に任せる（JSON を手で埋め込まない）
- **HTML のときだけ通す。** JS を HTMLRewriter に流すと、中身の `<` が要素の
  始まりとして解釈されて壊れる
- 差し込みが無ければ `src/admin/site.ts` の既定値に落ちる。設定が読めないだけで
  編集できなくなる理由は無い。**フォールバックが正常系なので、名前が食い違っても
  画面はそれらしく出る**（テストが meta の中身を突き合わせている）

`#/settings` の画面は**この値を表示するだけ**で、変更はできない。D1 に置いて
画面から変えられるようにする案もあったが、年に数回しか動かない値を DB へ移すと
git の履歴・レビュー・ロールバックの外に出る。今どうなっているかを確かめられれば
足りる、という判断（変えるときはソースを書き換えてデプロイする）。

### 一覧の絞り込み

`status` / `tag`（slug）/ `q`（キーワード）。`q` はタイトル・説明・本文を見る。

- **行と件数に同じ絞り込みを渡す。** `listAllPosts` と `countPosts` は別のクエリ
  なので、条件の組み立ては `postFilter()` 1 箇所に置いてある。片方だけ絞ると
  総件数が食い違い、ページャが「次がある」と言い続ける
- **LIKE の `%` と `_` をエスケープする**（`ESCAPE '\'`）。しないと `_` が
  「任意の 1 文字」として効き、`a_b` で検索したときに `axb` にも当たる
- 空文字は絞り込み無しと同じ扱い。画面の入力欄を空にすると `?q=` が飛んでくる
- 全文検索（FTS5）は使わない。D1 でも動くが、STRICT テーブルへのトリガ同期が要り、
  import / export の往復にも絡む。この規模（数百本）では LIKE の全走査で足りる
- 検索語は打ち終えてから送る（250ms）。1 文字ごとに投げると、日本語の変換中に
  中間の読みで検索してしまう
- **追い越した古い結果は捨てる。** 検索は本文への LIKE 全走査なので短い語ほど遅く、
  「早」の結果が「早朝」の結果より後に返ると、入力欄と一覧が食い違ったまま固まる
- 絞り込みは 1 つの reactive オブジェクトに入れる。別々の ref にすると、項目を
  足すたびに 5 箇所（クエリ・絞り込み中か・解除・ページ戻し・読み直し）へ同じ
  名前を書くことになり、どれか 1 つを落とすと黙って抜ける
- 空文字を「絞り込み無し」と読むのは API 側（`core/api/schema.ts` の `filterWord`）
  だけ。画面側でも同じ判断をすると、規則が 2 箇所になる

### 公開ページの管理リンク

管理画面を開いたことがある端末にだけ、公開ページのナビへ「管理」（記事ページでは
「この記事を編集」）が出る。

**判定はブラウザ側でする。** 公開ページは `s-maxage` で共有キャッシュに載るので、
ログイン中だけ HTML を変えると、その HTML が匿名の読者にも配られる（逆に匿名版が
載っていると管理者にリンクが出ない）。

- リンクの実体は**最初から HTML にあり、`hidden` で隠してあるだけ**。配る HTML は
  全員同じで、外すのは `src/site/client.ts` の数行
- 目印は `core/routes/admin.ts` が入口 HTML に付ける cookie。**権限は何も持たない**
  （偽造しても、出るのは Access のログインへ行くリンクだけ）
- **目印は名前と値を 1 つの単位で持つ**（`core/admin-contract.ts` の `ADMIN_HINT`）。
  読む側は cookie の 1 項目とこれを丸ごと比べるので、名前だけを共有すると、値を
  変えた日に比較が黙って false になる
- Access の `CF_Authorization` を直接見ないのは、あれが HttpOnly で JS から
  読めないため
- 目印が Access のセッションより長生きすることはある。そのとき押すとログイン画面に
  行くだけ
- **テーマに渡すのは完成した URL**（`PostView.adminUrl`）。identity を渡して
  テーマに組ませると、差し替えたテーマが「管理画面のハッシュの形」を知らないと
  同じ機能を作れない
- 編集 URL のハッシュの形は `core/paths.ts` の `ADMIN_HASH` が持ち、組む側
  （`urls.adminPost()`）と解く側（`src/admin/router.ts`）が同じものを見る。
  **食い違うと一覧が開くだけで気付けない**ので、E2E がリンクを実際に押して
  編集画面が出ることまで見る

## 画像の最適化

Cloudflare Images は**任意の層**。「後から有効にすると配信が良くなる追加機能」
として扱い、次の 3 つを守る。

- **配信 URL は Images の有無に関わらず同じ。** Images 固有の URL を Markdown にも
  `body_html` にも保存しない（ON/OFF・プラン差・quota 到達・将来の乗り換えの
  いずれでも、記事データを書き換えずに済む）
- **失敗したら原本を返す。** 未設定・利用不可・quota 到達・変換失敗のどれでも、
  記事の画像が表示不能にならない。**fallback は正式仕様**であって手抜きではない
- SVG は触らない（ベクタ）。GIF も触らない（動くものを潰さない）

相手の `Accept` を見て AVIF / WebP を選ぶ。**Cloudflare のエッジは
`Accept-Encoding` 以外の `Vary` を無視する**ので、変換して返すときは共有
キャッシュに載せない:

| 返すもの | `Cache-Control` | `ETag` |
|---|---|---|
| 原本（変換しない / 変換に失敗した） | `public, max-age=31536000, immutable` | R2 の `httpEtag` |
| 変換したもの | `private, max-age=86400` | `httpEtag` に `-webp` / `-avif` を足したもの |

`Vary: Accept` は**交渉した全ての応答**に付ける（原本を返した回も含む。
付け忘れると、変換なしで返った応答を「この URL は交渉しない」と誤解される）。
`ETag` を形式ごとに分けるのは、同じ URL から中身の違う応答が出るため。
分けないと `If-None-Match` に対して**別形式の 304** を返してしまう。

`private` なので Cloudflare のキャッシュには載らず、毎回 Images を通る。
**アクセスが増えて問題になったら `caches.default` に形式込みのキーで載せる**
（それまでは入れない）。

## portable な import / export

**入れられる形と出せる形が同じ。** 今の `blog/content/posts/` のレイアウトそのもの。

```
posts/<canonical-path>/index.md    frontmatter + 本文（相対参照のまま）
posts/<canonical-path>/sample.png  添付
```

D1 の dump（運用復旧用）とは別物。あちらは D1 / R2 という構成に依存するが、
こちらは Markdown と画像なので、**lily を捨てても記事が残る。**

口は `GET <mount>/api/export`（zip を返す）と `POST <mount>/api/import`
（multipart の `file`）。どちらも管理 API なので `AuthAdapter` の内側にある。

### frontmatter

| キー | export | import | 中身 |
|---|---|---|---|
| `title` | 必ず書く | 必須 | |
| `date` | 公開済みなら書く | 公開済みなら必須 | 公開日時。UTC ISO8601 |
| `updated` | 必ず書く | 省略可 | `updated_at` |
| `description` | あれば書く | 省略可 | |
| `tags` | あれば書く | 省略可 | 名前の配列 |
| `draft` | 下書きなら書く | 省略可 | 既定は公開済み |
| `public_id` | **必ず書く** | 省略可（採番する） | 不変の identity |
| `paths` | 必ず書く | 省略可 | canonical + alias |
| `media` | あれば書く | 省略可 | ファイル名 → 添付の `public_id` |

- **`public_id` を落とさない。** 落とすと再 import で記事の identity が変わり、
  URL も購読者側の同一性も壊れる。`media` を持っているのも同じ理由で、
  無いと `<mount>/media/<public_id>/…` が往復で変わる
- **`public_id` は記事のパスと同じ規則で検査する** (`normalizePostPath`)。
  素通しすると `public_id: admin` が `post_paths` に入って route を食う
  （createPost は identity 行を無検査で INSERT するので、止めるのはここだけ）
- **canonical はディレクトリ名が正**、`paths` は「その記事が持つ全パス」。
  ディレクトリを rename すると旧 canonical が alias として残る
  （`changeCanonicalPath` と同じ挙動）
- `created_at` と `bluesky_uri` は**持たない**。前者は表示に使わないので
  `date` → `updated` の順で当て、後者は D1 の dump 側の担当
  （portable な Markdown に lily 固有の状態を混ぜない）
- `public_id` / `paths` / `media` を省いた形（＝ Astro 版の frontmatter そのもの）が
  そのまま読める。**移行はこの経路**

### YAML は自前で読み書きする

汎用の YAML パーサを入れていない。この形式が lily の契約そのもので、書く側も
こちらなので、往復で形が変わらないことを自分で保証できるため。読み書きできるのは
スカラ・引用符付き・ブロック / フローの並び・1 段のマッピングだけで、**対応して
いない記法は黙って別物として解釈せず拒否する**（`src/core/transfer/frontmatter.ts`
の doc comment が対応表）。汎用の YAML が要るようになったら、差し替えるのは
このファイル 1 つ。

書く側は「このパーサが読み戻せるか」だけでは引用を決めない。**標準の YAML パーサが
真偽値や数値として読んでしまう文字列も引用する**（`#tag` / `true` / `0.5` /
引用符で始まる値）。export した Markdown は他の道具にも読まれうる。

### zip は書くとき無圧縮、読むとき deflate も

書く側を stored に固定しているのは、**同じ中身なら必ず同じバイト列になる**から。
圧縮の出力は実装に依存するので、往復の検証を「同じ書庫になるか」で書けなくなる。
記事は小さく添付は既に圧縮済みの画像なので、代償はほとんど無い。

そのために日時もデータ由来にしてある（記事は `updated_at`、添付は `created_at`）。
**実行時刻を入れてはいけない。** なお MS-DOS の日時は 2 秒刻みなので、
「2 回 export して比べる」だけでは実行時刻が混ざっていても通ってしまう
（`test/transfer/transfer.test.ts` はローカルヘッダの日時を直接見ている）。

読む側で deflate も受けるのは、**手元で普通に zip した書庫を取り込めるように**
するため。CRC は毎回検算する（壊れた書庫を黙って取り込むと、記事が欠けたことに
後から気付けない）。zip64 は未対応。

### 取り込みの規則

- **記事ごとに独立して取り込み、失敗した記事だけを返す。** 1 本の frontmatter が
  壊れていたせいで書庫まるごと入らない形にはしない（移行の途中で必ず起きるうえ、
  どれが悪いのか分からなくなる）
- **既にある `public_id` は上書きしない。** 上書きの意味は「本文だけ」「パスも」
  「消えた添付も」で変わり、取り違えると記事が壊れる。復旧（空の DB へ入れ直す）と
  移行にはこれで足りるので、必要になってから決める
- **タグは記事を作る前に解決する**（管理 API と同じ理由）
- **添付を入れてから描く。** 逆にすると `./sample.png` が解決できず、貼ってある
  はずの画像が公開ページから消える
- 書庫に Content-Type は無いので、**添付の形式は拡張子で決める**（管理 API が
  受け付ける範囲と同じ）。それ以外は警告にして記事は取り込む
- `index.md` が無いディレクトリは記事ではない。記事の下のさらに下にあるファイルも
  添付にできない（`media.filename` に `/` を入れられないため）
- **書庫から来た `public_id` は記事のパスと同じ規則で見る。** 記事のものは予約語が
  route を食うから、添付のものは空文字が `<mount>/media//<filename>` という
  どこにも当たらない URL になるから（`media.public_id` には `NOT NULL UNIQUE` しか無い）
- **frontmatter の `__proto__` は入口で断る。** 素のオブジェクトに代入しても
  キーが生えないので、通すと「知らないキーは拒否する」の網を黙ってすり抜ける

### 増えたときに効く上限

書庫は**丸ごとメモリに載る**。import は 50MB までにしてあるが、Workers の 128MB と
subrequest の上限（添付 1 つにつき R2 が 1 回）に当たる日が先に来る。記事が数百を
超えたら、範囲を指定して分けて出す形が要る。

## バックアップ

**毎日 1 回、記事と添付を portable な zip にして別の R2 バケットへ置く。**
Worker 自身の Cron Trigger（`wrangler.jsonc` の `triggers.crons`、UTC 18:30 = JST 3:30）
から `src/index.ts` の `scheduled` が走り、中身は `core/backup.ts`。

- **中身は `<mount>/api/export` と同じ書庫。** D1 の dump（`wrangler d1 export`）は
  D1 という構成に依存するが、こちらは Markdown と画像なので **lily を捨てても
  記事が残る**。控えの経路に別実装を挟まないので、往復の検証（`test/transfer/`）が
  そのまま控えにも効く
- **置き場所は別バケット**（`fushihara-net-lily-backup`）。添付と同じバケットに
  prefix を分けて入れると、バケットごとの誤削除やライフサイクル規則の事故で
  本体と控えが同時に消える。控えの意味は「別の場所に置くこと」
- **保持は 30 世代。日数で切らない。** 「n 日より古いものを消す」にすると、cron が
  止まっているあいだに全部が古くなり、**残っている控えを全部消す**。数で切れば
  最後に取れたものは必ず残る
- 名前は `archives/lily-<UTC の ISO8601 から記号を落としたもの>.zip`。辞書順が時刻順に
  なるので、世代の判定に日付の解析が要らない（R2 の `list` は key の昇順）
- 何が入っているかは `customMetadata`（`posts` / `media` / `warnings`）に載せる。
  書庫を開かずに R2 の一覧から読める
- **Access の外側から動く。** 管理 API は Access の内側にあり、サービストークンの
  JWT は `sub` が空文字なので `auth/access.ts` が拒否する（「記事の入れ方」）。
  機械が通れる口を開けるより、Worker 自身から D1 と R2 を直に読む方が穴が 1 つ少ない
- **`waitUntil` に逃がさず await する。** 逃がすとハンドラは成功したことになり、
  失敗をログまで見に行かないと気付けない

**最初の 1 回が走ったかは翌朝に確かめる。** Workers の cron は手で発火させられないので、
`npx wrangler r2 object list fushihara-net-lily-backup --remote --prefix archives/` で
書庫が増えているかを見る（ログは `npx wrangler tail` か dashboard の Observability）。
手元で配線だけ試すなら `npx wrangler dev -c ./wrangler.jsonc --test-scheduled` の
`/__scheduled` を叩く（ローカルの D1 / R2 に対して走る）。

**この書庫が持たないもの**: `bluesky_uri` と `created_at`（portable な形式が持たない。
「portable な import / export」の節）。D1 を失って書庫だけから戻すと、**告知済みかどうかが
消える**ので、`bluesky_uri` が担っている二重投稿の抑止が効かなくなる。そこまで含めて
戻したいときは D1 の dump が要る（下記。こちらは手動）。

```bash
# 控えを手元へ。**`--remote` が要る。** r2 object 系はローカルの模擬ストレージが既定で、
# 付け忘れると本物のバケットを見に行かず「キーが無い」とだけ言われる
# （`r2 bucket list` は remote が既定という非対称がある。実際に踏みかけた）
npx wrangler r2 object get fushihara-net-lily-backup/archives/lily-<stamp>.zip \
  --remote --file /tmp/restore.zip

# 運用復旧用の D1 dump（bluesky_uri と created_at を含む）
npx wrangler d1 export DB -c ./wrangler.jsonc --remote --output <file>
```

## Astro からの移行（済）

2026-08-29 に完了し、Astro 側（`blog/content/posts/` と `fushihara-net-blog` Worker）は
翌日に消した。**記事の原本は D1 だけ**で、Markdown を読み返したいときは
`git show 1361402:blog/content/posts/<slug>/index.md`。以下は当時の記録。

**やったのは `blog/content/posts/` を zip にして `<mount>/api/import` に投げること
だけ。** `public_id` / `paths` / `media` を省いた frontmatter がそのまま読めるので、
移行用のコードを別に書かずに済んだ。**この形は今も入口として生きている**ので、
別のところから記事を持ち込むときも同じ道を通す（`CONTRACT.md`）。

```bash
npm run db:migrate:local && npm run build && npm run dev   # 別の端末で
cd ../blog/content && zip -r /tmp/migrate.zip posts        # posts/<slug>/index.md の形
curl -X POST http://localhost:8787/blog/api/import \
  -H 'Origin: http://localhost:8787' -F 'file=@/tmp/migrate.zip'
```

`imported` / `failed` / `ignored` が返る。**`failed` と `ignored` が空であること**を
確かめること（記事が 1 本落ちても 200 で返る）。

### Astro の出力と変わるところ

実記事 8 本で突き合わせた結果。**意図した差分**:

| 何 | 変化 |
|---|---|
| タグ | `<span class="tag">` → `<a href="<mount>/tags/…/">`（タグ一覧ページを足したため） |
| 画像 | `/blog/_astro/<hash>.svg` → `<mount>/media/<public_id>/<filename>` |
| 脚注 | 見出しと戻りリンクが英語 → 日本語 |
| sitemap / 一覧 | `<mount>/tags/…` が増える |
| 同日公開の並び | slug 昇順 → **`public_id` 昇順**（下記） |

RSS の全文（`content:encoded`）は、XML として解析すれば上記以外**完全に一致**する。
生の文字列は違って見えるが、これは `"` を `&quot;` に逃がすかどうかの差で、XML の
テキストノードでは不要な逃がし。本体サイトの `/api/blog`（正規表現で読む）も
そのまま通ることを確認済み。

**同日に公開した記事の並びは変わる。** tie-break が `public_id` 昇順なので、
移行の時点で採番された uuid 次第。**同じ日の順序を決めたいときは `published_at` に
時刻を入れる**（この運用は Astro 版から変わっていない）。

`<img>` の `loading` / `decoding` / `width` / `height` は**埋めた**（上の
「`<img>` の属性」）。Astro が付けていたものとの差は、寸法を読めない添付
（AVIF や `viewBox` の無い SVG）で `width` / `height` が出ないことだけ。

## 本番の配線

| 何 | 値 |
|---|---|
| Worker | `fushihara-blog` |
| cron | `30 18 * * *`（UTC。JST 3:30 に控えを取る） |
| route | `fushihara.net/blog*`（**末尾の `*` は必須**。無いとクエリ付き URL に一致しない） |
| Access | アプリ `fushihara-blog`。パスは `blog/admin` と `blog/api` の 2 本（**ワイルドカード無し**） |
| AUD | `wrangler.jsonc` の `ACCESS_AUD`。**アプリを作り直すと変わる**（名前の変更では変わらない） |
| D1 / R2 | `fushihara-net-lily` / `fushihara-net-lily-media`（控えは別バケット `fushihara-net-lily-backup`） |
| 本体からの参照 | ルート `wrangler.jsonc` の `services`（`BLOG` → `fushihara-blog`） |

**Zero Trust のダッシュボードはメニュー名が変わった。** 旧「Access」は
**Access controls** で、その下に Applications / Policies / Access settings が並ぶ。
AUD タグはアプリを開いた先の **Additional settings の一番下**（かつての Overview では
ない）。セッションの長さは 3 箇所（グローバル / アプリ / ポリシー）にあり、**延ばしたい
なら Access settings の「Set your global session duration」**（既定 24 時間）。優先順位は
ポリシー > アプリ > グローバルだが、グローバルは再ログインの頻度そのものなので、
アプリだけ延ばしてもグローバルが切れれば再ログインになる。

**AUD が合っているかは管理画面を開けば分かる。** ずれていると Access のログインは
通っても lily が JWT を拒否して 403 になるので、記事一覧まで出た時点で一致している。

デプロイは `.github/workflows/deploy-blog.yml` が main への push で行う
（`blog/**` `shared/**` と自分自身が変わったときだけ）。**マイグレーションが先、
`wrangler deploy` が後。** 逆にすると新しい列を読むコードが古いスキーマに当たる。

mount を変えるのは `src/site/meta.ts` の `MOUNT_PATH` 1 行。テストも E2E も
そこから引いているので、mount の往復で spec を書き換えずに済む。

**配線を動かす手順は `SWITCHOVER.md`。** 順序を間違えると公開ブログを締め出すので、
その場で考えずにあれを読むこと。

### ここで踏んだ罠

- **Access のパスは文字列の前方一致。** アプリのパスに `blog` を入れると
  `/blog` だけでなく **`/blog-next` も掴む**。並走を始めるときにこれをやって、
  **当時の公開ブログを読者ごと締め出した**（RSS も含めて全部 Access のログインへ
  302 した）。`/blog/admin` に絞った今も、将来 `/blogroll` のようなパスを足すと
  巻き添えになる
- **`routes` を書くと `wrangler dev` のリクエスト host が実ドメインになる。**
  route のゾーン（`fushihara.net`）を origin として渡すので、`localhostOnly` が
  「ローカルではない host」として拒否し、**管理画面も E2E のフィクスチャ投入も
  403 になる**。`wrangler.jsonc` の `"dev": { "host": "localhost" }` で戻す
- **CI のトークンは「Account API Token」。** deploy ジョブの `db:migrate` が
  `code: 7403`（D1 へのアクセス権限なし）で落ちたときに、User API Token の一覧
  （`dash.cloudflare.com/profile/api-tokens`）を見ても目当てのトークンが無い。
  編集するのは **Manage Account → API Tokens**（`dash.cloudflare.com/<account>/api-tokens`）
  の方で、要るのは **Account / D1 / Edit**。どちらのトークンかは
  `npx wrangler whoami` が教えてくれる（トークンの値は出ない）
- **`.dev.vars` は vitest のプールも読む。** ローカルで Access を打ち消すために
  置いてあるので、ユニットテストから見える `ACCESS_TEAM` も空になる。
  「この deployment は Access を使う」という assertion はテスト環境からは書けない
  （本番の値は `wrangler.jsonc` の `vars`）

### 記事の入れ方（Access の内側）

管理画面に import / export のボタンは無いので、書庫は API へ直接投げる。**Access を
通った JWT が要る**ので、`cloudflared` で人としてログインしてから叩く。

```bash
cloudflared access login https://fushihara.net/blog/
cloudflared access curl https://fushihara.net/blog/api/import \
  -X POST -H 'Origin: https://fushihara.net' -F 'file=@/tmp/migrate.zip'
```

**サービストークンでは通らない。** Access がサービストークンに出す JWT は `sub` が
空文字で（識別子は `common_name` に入る）、`core/auth/access.ts` は `sub` が無いものを
拒否する。だから**機械から叩く口は作らず**、バックアップは Access の外側
（Worker 自身の Cron Trigger）から D1 と R2 を直に読む形にしてある（「バックアップ」の節）。

## E2E

`e2e/blog.spec.ts` は Astro 版の `blog/e2e/blog.spec.ts` を**そのまま引き継いだもの**。
生成器を差し替えても入出力の契約は変わらない、というのが `CONTRACT.md` の趣旨で、
ここがその出番。**lily 固有の API をここに持ち込まない**（HTTP と DOM から見える
ものだけで合否を出す）。

- フィクスチャは `e2e/fixtures/posts/`。**seed に生 SQL を使わない**のは、添付の実体が
  R2 に要るから。import なら D1 と R2 の両方が同時に埋まる（`e2e/seed.setup.ts`）
- **D1 と R2 は dev と分ける。** `--persist-to .wrangler/e2e` に逃がし、起動のたびに
  捨てる。既定の場所を使うと E2E が手元の記事を消してフィクスチャで上書きする
- ポートは 8788（`wrangler dev` の既定 8787 と分ける。`reuseExistingServer: false`
  なので、同じにすると dev を開いたままテストを回せない）
- **状態を変えるテストは 1 プロジェクトだけで走らせる。** desktop と mobile は
  同じサーバーを共有しているので、プレビューの発行・失効が互いに効いてしまう
- `mount` を spec に直接書かない。`e2e/helpers.ts` が `src/site/meta.ts` から読む
  （切り替えのたびに全 spec を書き換えないため）

**`src/site/meta.ts` には import を足さないこと。** E2E と `playwright.config.ts` が
Node からこれを読むので、設定を辿って CSS まで引き込むと起動しなくなる。

**`e2e/` は `tsconfig.e2e.json` で型検査する**（`npm run typecheck` が回す）。
Workers のランタイム型と DOM は同じプロジェクトに入れられないので分けてあるが、
**型検査の外に置かない**こと。`src/` の export を変えたときに Playwright を
回すまで気付けなくなる。

## 増えてから壊れるもの

件数が少ないうちは通ってしまうので、意識して見張る。

- **D1 のバインドパラメータは 1 クエリ 100 個まで。** `IN (?1, ?2, …)` を id の
  数だけ並べるクエリは `core/db/chunk.ts` を通す
- 一覧は **20 件ごと**（`/blog/page/2/`）、フィードは**直近 50 件**、管理画面は
  30 件ごと。全件返していると、記事が増えたぶんだけ重くなる（フィードは全文を
  配るので特に）
- **sitemap は今も全件。** 50,000 URL / 50MB の上限に当たったら分割が要る

## テストの方針

- D1 の制約（`STRICT` / `CHECK` / 部分ユニーク索引）は**生 SQL で叩いて確かめる**。
  アプリ側の検証を通らない経路でも壊れた行が入らないこと自体が仕様なので、
  query layer 越しに見ても検証にならない
- スキーマの正は `migrations/*.sql` の 1 箇所。テストは
  `readD1Migrations()` でそれを読んで適用する。テストだけ別のスキーマを持たない
