# ブログの契約

このディレクトリの生成器（現在は Astro）は**使い捨て**で、将来自作 OSS に置き換える。
置き換えのときに持ち越すのは次の 4 つだけで、それ以外は捨ててよい。

1. `content/` 以下の Markdown
2. URL 設計
3. HTML 構造と CSS
4. `e2e/` のテスト

このファイルは「新しい生成器が満たすべき仕様」であり、同時に「今の実装が
踏み越えてはいけない線」でもある。

## 入力

- 記事は `blog/content/posts/<slug>/index.md` の 1 形式のみ。
  `<slug>` がそのまま URL になる。ディレクトリを掘れば `<a>/<b>/index.md` →
  `/blog/a/b/` になるが、**ディレクトリ構造がそのまま URL** である点に注意。
- **`index.md` 以外の Markdown は読み込まれない。** 直置きの `posts/foo.md` も、
  記事の隣に置いた `notes.md` も無視される。黙って消えると気付けないので、
  `scripts/assert-post-layout.sh` がビルドを止める。
- 読み込み先は環境変数 `BLOG_CONTENT_DIR` で差し替えられる。**これは E2E のためだけの
  逃げ道**で、`blog/test-content/posts/` のフィクスチャを読ませるのに使う
  （下記「テスト用の固定物」）。素のビルドは必ず `content/posts` を読む。
- 画像などの添付は記事と同じディレクトリに置き、Markdown からは相対パス
  （`![alt](./sample.png)`）で参照する。
- 本文は **CommonMark + GFM のみ**。
- フロントマターは YAML で、キーは次のものだけ。

  | キー | 型 | 必須 | 意味 |
  |---|---|---|---|
  | `title` | string | ○ | 記事タイトル |
  | `date` | date (`YYYY-MM-DD`) | ○ | 公開日 |
  | `updated` | date | | 更新日 |
  | `tags` | string[] | | 既定は `[]` |
  | `description` | string | | 一覧と OGP に出る要約 |
  | `draft` | boolean | | `true` は本番ビルドから除外。既定は `false` |

  このスキーマは `src/content.config.ts` に zod で書いてあり、ビルド時に検証される。
- **キーを置いて値を空にした場合（`description:`）は、省略したのと同じ扱い。**
  YAML ではこれが `null` になり、素の zod では別物として弾かれる。テンプレートを
  埋めながら書くと必ず起きるので揃えてある。`title` と `date` は必須なので、
  空欄はエラーのまま（書き忘れを教えたい）。

## 並び順

一覧と RSS はどちらも **`date` の降順（新しい順）**。`date` が同じときは **slug の昇順**。

同日内の順序を自分で決めたいときは `date` に時刻を付ける
（`date: 2026-08-23T21:00:00+09:00`）。時刻は slug より優先される。

日付の表示・`<time datetime>`・RSS の `pubDate` はすべて **Asia/Tokyo 基準**。
ビルド機の TZ には依存しない。

## 出力

| パス | 内容 |
|---|---|
| `/blog/` | 記事一覧（新しい順） |
| `/blog/<slug>/` | 記事本体 |
| `/blog/rss.xml` | RSS 2.0。`link` は絶対 URL |
| `/blog/sitemap-index.xml` | サイトマップ |
| `/blog/404.html` | 404 ページ |
| `/blog/favicon.svg` | favicon（テーマ追従） |
| `/blog/favicon.ico` | favicon（SVG 非対応ブラウザ向け） |
| `/blog/apple-touch-icon.png` | ホーム画面用アイコン |

- **URL は末尾スラッシュありで固定**。無しでのアクセスは 301/307 で有りへ寄せる。
- favicon 3 点は `/blog/` 直下へそのまま出す。中身を作る必要はなく、
  リポジトリにあるファイルをコピーするだけ（置き場所は実装側の都合）。
- 一度公開した URL は変えない。RSS 購読者のリーダーと被リンクが握っているため。
- ビルド成果物は `dist/blog/` に出す。配信は `dist/` を丸ごと静的アセットとして
  置く形なので、出力パスと URL が 1:1 で対応している必要がある。

## 禁止事項（守らないと移行費用が跳ね上がる）

- **MDX を使わない。** 本文にコンポーネント import を書いた瞬間、記事が
  Astro 専用言語になる。
- **Astro のテーマを入れない。** レイアウトと CSS は自分で持つ。
- **`astro:` 名前空間のものを本文（Markdown）に持ち込まない。**
  `src/` 以下の実装が使うのは構わない（そこは捨てる側）。
- **フロントマターに生成器固有のキーを足さない。** 上の表がすべて。

## テーマ

色とフォントのトークンはリポジトリ直下の `shared/tokens.css` が正本で、本体サイトと
共用する。`localStorage` のキーも `shared/theme.ts` の `STORAGE_KEY` を共用する
（ずれると `/` と `/blog/` を行き来したときにテーマの選択が引き継がれない）。

## テスト用の固定物

E2E は `content/` の実記事ではなく **`test-content/posts/` のフィクスチャ**に対して
回す。実記事に依存させると、記事を書き換えるたびにテストが落ちるため。

| フィクスチャ | 守っているもの |
|---|---|
| `rendering-sample/` | 見出し・コード・画像・引用・表が期待どおり描画されること、コードの色がテーマで入れ替わること |
| `draft-example/` | `draft: true` が本番ビルドから落ちること。frontmatter の空欄キーが省略として扱われること |
| `order-time-a/` `order-time-z/` | 同日でも時刻が slug より優先されること。早朝 JST の記事が前日として表示されないこと |
| `order-tie-a/` `order-tie-b/` | `date` が同じときに slug の昇順になること |

並び順の検査は一覧の全記事を順番どおりに突き合わせているので、**フィクスチャを増やすと
落ちる**。増やすときは `e2e/blog.spec.ts` の期待値も直すこと。

どちらも消さないこと。中身を変えるときは `e2e/blog.spec.ts` の該当検査も一緒に直す。

**フィクスチャを `content/` に置かないこと。** 置くと公開される。逆に実記事を
`test-content/` に置いても公開されない。

content layer のストアは読み込み先を覚えていないので、切り替えが混ざらないように
ビルドは `cacheDir` を分け、dev は起動のたびにストアを捨てている（詳細はリポジトリ
直下の `CLAUDE.md`）。最後の砦として `npm run deploy` が
`scripts/assert-no-fixtures.sh` で配信物を検査する。

## 合格条件

`blog/e2e/blog.spec.ts` が通ること。このテストは Astro の API に一切触れておらず、
上の入出力だけを検査しているので、生成器を差し替えた日にそのまま合否判定に使える。

```bash
cd blog && npm run test:e2e
```
