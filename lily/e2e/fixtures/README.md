# E2E のフィクスチャ

**記事ではない。** `e2e/blog.spec.ts` が中身に依存しているので、書き換えるときは
テストも一緒に直すこと。

実記事に対して回すと、記事を 1 本書くたびにテストが落ちる。だからここを別に持つ。
形式は portable import/export と同じ (`posts/<canonical>/index.md` + 添付) で、
`e2e/seed.setup.ts` が zip にして `<mount>/api/import` に投げる。

**seed に生 SQL を使っていない**のは、添付の実体が R2 に要るから。SQL では
D1 の行しか作れず、画像が置けない。import なら D1 と R2 の両方が同時に埋まる。

| ディレクトリ | 何を守っているか |
|---|---|
| `rendering-sample/` | 見出し・コード・画像・引用・本文中の HTML の描画。RSS の全文配信 |
| `order-time-a/` `order-time-z/` | 同じ日でも時刻で並ぶこと。早朝 JST が前日にならないこと |
| `order-tie-a/` `order-tie-b/` | **同時刻の tie-break が `public_id` 昇順**であること |
| `draft-example/` | 下書きが公開側に出ないこと。プレビュー URL でだけ見えること |
| `aliased/` | 旧 URL が alias として残り、canonical へ 308 されること |

## public_id を固定してある

すべての記事が frontmatter に `public_id` を持つ。テストから名指しできるのと、
**並び順を決めているのが `public_id` だから**。

`order-tie-a` / `order-tie-b` は **名前の順と `public_id` の順をわざと逆にして
ある**（`a` が `...0005`、`b` が `...0004`）。Astro 版の「同日なら slug 昇順」に
戻したり、tie-break を内部 id に変えたりすると、この 2 本の並びが入れ替わって
テストが落ちる。順序を揃えてしまうと、どちらの規則でも通ってしまい**何も
検証しない**フィクスチャになる。

## 下書きの空欄キー

`draft-example/index.md` は `description:` と `tags:` を**キーだけ書いて値を空に
してある**。YAML ではこれが `null` になり、素の zod だと省略とは別物として弾かれる。
テンプレートを埋めながら書けば必ず踏むので、そこが吸収されていることをここで見る。
