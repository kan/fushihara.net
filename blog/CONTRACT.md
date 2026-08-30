# ブログの契約

このディレクトリの生成器（現在は **lily**）は**いつか置き換わる**前提で書いてある。
置き換えのときに持ち越すのは次の 4 つで、それ以外は捨ててよい。

1. 記事データ（D1 が正。出し入れの形は下記の portable な zip）
2. URL 設計
3. HTML 構造と CSS
4. `e2e/blog.spec.ts`

このファイルは「新しい生成器が満たすべき仕様」であり、同時に「今の実装が
踏み越えてはいけない線」でもある。**実装がどう作られているかは
[`README.md`](./README.md) の担当**で、こちらには外から見える約束だけを書く。

一度この契約を通り抜けた実績がある。2026-08-29 に Astro（ファイルベースの静的生成）
から lily（D1 を正とする自作 CMS）へ替えたとき、**記事の URL も RSS の `guid` も
変えずに済んだ**。そのとき何が効いたかは各節に書いてある。

## 記事データ

**正は D1。** ファイルではない。

だが**記事は必ず外へ出せる形を持つ**。`<mount>/api/export` が返す zip がそれで、
中身は次の形をしている。`<mount>/api/import` は同じ形を読む。

```
posts/<canonical path>/index.md   本文と frontmatter
posts/<canonical path>/<file>     その記事の添付（相対パスで参照されているもの）
```

- 本文は **CommonMark + GFM のみ**
- 添付は記事と同じディレクトリに置き、本文からは相対パス（`![alt](./sample.png)`）で
  参照する。**本文に mount（`/blog/...`）を埋め込まない。** 埋め込むと、mount を
  変えた日に全記事の書き換えが要る
- frontmatter のキーは次のものだけ

  | キー | 型 | 必須 | 意味 |
  |---|---|---|---|
  | `title` | string | ○ | 記事タイトル |
  | `date` | date | ○ | 公開日時 |
  | `updated` | date | | 更新日 |
  | `tags` | string[] | | 既定は `[]` |
  | `description` | string | | 一覧と OGP に出る要約。省くと本文の冒頭から作られる |
  | `draft` | boolean | | `true` は公開側に出ない |
  | `public_id` | uuid | | 記事の identity。**省くと新規採番** |
  | `paths` | string[] | | canonical と alias。省くと `public_id` が URL |

- **キーを置いて値を空にした場合（`description:`）は、省略したのと同じ扱い。**
  YAML ではこれが `null` になり、素の zod では別物として弾かれる
- **`public_id` と `paths` を省いた形が、そのまま「よそから持ち込む形」**になる。
  Astro 版の frontmatter が上の表の前半だけだったのは偶然ではなく、移行を
  「zip にして投げるだけ」にするためにこの表を先に決めてあった

**往復で identity と URL が保たれること**を `test/transfer/` が見張っている。
export → import で `public_id` と canonical path が変わる実装は、この契約を満たさない。

## URL

| パス | 内容 |
|---|---|
| `/blog/` | 記事一覧（新しい順）。2 ページ目以降は `/blog/page/2/` |
| `/blog/<path>/` | 記事本体 |
| `/blog/tags/<slug>/` | タグごとの一覧 |
| `/blog/rss.xml` | RSS 2.0。全文配信 |
| `/blog/atom.xml` | Atom。全文配信 |
| `/blog/posts.json` | 本体サイトの Blog 付箋が読む口 |
| `/blog/media/<public_id>/<filename>` | 添付 |
| `/blog/sitemap-index.xml` / `/blog/sitemap-0.xml` | サイトマップ（2 本に分けるのは現行の URL を維持するため） |
| `/blog/styles.css` | スタイルシート |
| `/blog/favicon.svg` / `.ico` / `apple-touch-icon.png` / `ogp.png` | アイコンと OGP 画像 |
| `/blog/admin/` / `/blog/api/*` | 管理画面と管理 API（**認証の内側**） |

- **末尾スラッシュありで固定。** 無しでのアクセスは 308 で有りへ寄せる
- **一度公開した URL は変えない。** RSS 購読者のリーダーと被リンクが握っている。
  変える必要が出たときは**旧 URL を alias として残し、canonical へ 308 する**
  （記事の identity を URL から独立させてあるのはこのため）
- 上の表の第 1 セグメントは**予約語**で、記事のパスには使えない。`_` 始まりも予約

## フィード

- **全文を配る。** `<description>` / `<summary>` は要約、`<content:encoded>` /
  `<content>` に本文の HTML 全体を入れる
- **中の URL はすべて絶対 URL にする。** リーダーは記事の URL を起点に相対 URL を
  解決してくれないので、画像・記事内リンク・脚注のアンカーが全部壊れる
- **中では CSS 変数に頼らない。** リーダーはこのブログのスタイルシートを読まないので、
  色は要素に直接書く（コードハイライトが該当する）
- **`guid` は記事の URL。** ここを `urn:uuid:` のような別の識別子に変えると、
  購読者のリーダーに**全記事が新着として配り直される**。生成器を替えても変えない
- **購読者にはポートフォリオ本体も含まれる。** トップの Blog 付箋は本体 Worker の
  `/api/blog` が `/blog/posts.json` を読んで組み立てている（リポジトリ直下の
  `CLAUDE.md`）。生成器を替えるときは、`title` / `url` / `published_at` が
  そのまま読めることを確認する

## 日付

表示・`<time datetime>`・`pubDate` はすべて **Asia/Tokyo 基準**。動かす機械の TZ に
依存しない。変換は `shared/date.ts` が持ち、本体サイトと共用する（同じ記事の日付が
`/` と `/blog/` でずれないため）。

並びは**公開日時の降順**。同時刻のときは `public_id` の昇順を tie-break に使う。
**同じ日の順序を決めたいときは公開日時に時刻を入れる。**

## 禁止事項（守らないと移行費用が跳ね上がる）

- **本文を生成器専用言語にしない。** MDX のようにコンポーネントを import できる形は、
  記事をその生成器でしか読めなくする
- **フロントマターに生成器固有のキーを足さない。** 上の表がすべて
- **本文に mount を埋め込まない。** 画像は相対参照のまま保存し、公開 URL は
  配信時に解決する
- **レイアウトと CSS は自分で持つ。** 生成器付属のテーマに乗らない
- **URL を変えない。**

## テーマ

色とフォントのトークンはリポジトリ直下の `shared/tokens.css` が正本で、本体サイトと
共用する。テーマの保存キーも `shared/theme.ts` の `STORAGE_KEY` を共用する
（ずれると `/` と `/blog/` を行き来したときにテーマの選択が引き継がれない）。

## テスト用の固定物

E2E は実記事ではなく **`e2e/fixtures/posts/` のフィクスチャ**に対して回す。実記事に
依存させると、記事を書き換えるたびにテストが落ちるため。形式は上の portable な zip と
同じで、`e2e/seed.setup.ts` が投げ込む（**生 SQL で seed しない**。添付の実体が R2 に
要るので、SQL では画像が置けない）。

何を守っているかは [`e2e/fixtures/README.md`](./e2e/fixtures/README.md)。**どれも
消さないこと。** 中身を変えるときは `e2e/blog.spec.ts` の該当検査も一緒に直す。

## 合格条件

`e2e/blog.spec.ts` が通ること。**このテストは lily の API に一切触れていない。**
HTTP と DOM から見えるものだけで合否を出すので、生成器を差し替えた日にそのまま
判定に使える（`e2e/admin.spec.ts` は lily 固有なので分けてある）。

```bash
cd blog && npm run test:e2e
```

Astro から lily へ替えたときに実際にこれで判定した。**あのとき spec に足した lily
固有の検査は 1 つも無い。** 次に替える人が同じことをできるよう、ここは守ること。
