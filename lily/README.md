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
- フィード（RSS 維持 + Atom 追加）、sitemap、favicon / ogp の配信
- 添付の配信（R2 が原本、Cloudflare Images は任意の最適化層）
- `AuthAdapter` と Cloudflare Access アダプタ、`<mount>/api/*` と
  `<mount>/admin/*` の保護境界
- 管理 API（記事の CRUD・公開/取り下げ・パス変更・プレビュー URL・添付・再描画）
- portable な import / export（Markdown 一式の zip。往復で identity と URL が保たれる）
- `posts.json`（本体サイトの Blog 付箋が読む口）
- Vue の管理画面（一覧・編集・プレビュー・画像 D&D・パス変更・プレビュー URL・
  公開日時・タグ補完・ページング）

まだデプロイしていない（route を張っていない）。ローカルでは動く。

## コマンド

```bash
npm install
npm test                 # Vitest。実 workerd + 実 D1 で動く
npm run typecheck        # wrangler types → tsc
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
    media/    画像の最適化（任意。無くても原本で配れる）
    render/   Markdown → HTML。保存する側と配信する側で 2 段に分ける
    transfer/ portable な import / export。frontmatter・zip・往復の規則
    routes/   fixed.ts がルーティング定義の正本。public.ts が人向け、
              feeds.ts が機械向け、media.ts が添付、api.ts が保護境界
    theme.ts  テーマが実装する型。core は HTML を 1 バイトも持たない
  site/       fushihara.net 固有（レイアウト・CSS・文言・OGP・クライアント JS）
  admin/      Vue の管理画面。別ビルド（vite）で dist/admin に出る
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
  書かない言語は入れない（Worker 全体は gzip 約 410 KiB で、その大半がこれ）。
  測るときは `npx wrangler deploy -c ./wrangler.jsonc --dry-run` の Total Upload
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
| 画像記法の組み立て（空白を含む名前の `<…>`） | `core/render/markdown.ts` |
| 添付の R2 キーの決め方 | `core/db/media.ts` の `mediaR2Key` |
| portable な形式（frontmatter のキーと並び） | `core/transfer/format.ts` |
| その形式の YAML をどこまで読むか | `core/transfer/frontmatter.ts` |
| 日時の JST 変換 | `shared/date.ts` |
| 見た目・文言・OGP（差し替え点） | `core/theme.ts` の `Theme` を `site/` が実装 |
| キャッシュ方針 | `core/routes/cache.ts` |
| 保存済み HTML と描画の使い分け | `core/delivery.ts` |
| 開始タグの中の `src` / `href` の書き換え | `core/render/html.ts` の `rewriteUrlAttributes` |
| D1 のバインドパラメータ上限（100）への対処 | `core/db/chunk.ts` |

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
- 添付は形式とファイル名を検査する。ファイル名は記事のパスと同じ
  `normalizeSegment` を通す（export でそのままディレクトリに書き出すため）
- `POST /api/link-title` は**外から来た URL をそのまま fetch する口**。
  http/https だけ・IP リテラルとローカル向けの名前を弾く・**リダイレクトを自分で
  追って飛び先も毎回検査する**・5 秒で打ち切る・先頭 64KB だけ読む、で狭めてある
  （`redirect: 'follow'` に任せると最初の 1 回しか検査されず、公開 URL から
  内側へ飛ばされる）

## 管理画面

`<mount>/admin/`。Vue の SPA で、Worker とは別のビルド（`vite build`）。

- **`base: './'` と、mount をパスから割り出す。** 同じ成果物が `/blog` でも
  `/blog-next` でも動く（deployment の設定をビルドに焼き付けない）
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
- **SPA の fallback から `assets/` を外してある。** ハッシュ付きのバンドルが
  無いときに `index.html` を 200 で返すと、古いタブが JS の代わりに HTML を
  受け取って構文エラーで固まる（404 なら再読み込みで直る）

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


### 増えたときに効く上限

書庫は**丸ごとメモリに載る**。import は 50MB までにしてあるが、Workers の 128MB と
subrequest の上限（添付 1 つにつき R2 が 1 回）に当たる日が先に来る。記事が数百を
超えたら、範囲を指定して分けて出す形が要る。

## Astro からの移行

**`blog/content/posts/` を zip にして `<mount>/api/import` に投げるだけ。**
`public_id` / `paths` / `media` を省いた frontmatter がそのまま読めるので、
移行用のコードを別に書かない。

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

### まだ埋めていない差分

`<img>` から `loading="lazy"` / `decoding="async"` / `width` / `height` が消える。
Astro の画像パイプラインが付けていたもので、**`width`/`height` が無いとレイアウト
シフトが起きる**。`media` テーブルに列だけは用意してあるが、アップロード時に画像の
寸法を読む処理がまだ無い。

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
