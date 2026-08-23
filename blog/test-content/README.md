# test-content

E2E 専用の記事。**公開されない。**

`blog/e2e/blog.spec.ts` が「Markdown が期待どおり描画されるか」「`draft: true` が
本番ビルドから落ちるか」を検査するための材料で、`content/` の実記事とは完全に分けて
ある。分けていないと、記事を書き換えるたびにテストが落ちる。

`playwright.config.ts` が `BLOG_CONTENT_DIR` にこのディレクトリを指定してビルドする。
`npm run build` を素で叩いたときは `content/` が読まれるので、ここの中身が本番に出る
ことはない。

中身を変えるときは `blog/e2e/blog.spec.ts` の該当検査も一緒に直すこと。とくに並び順の
検査は一覧の全記事を順番どおりに突き合わせているので、**記事を足すと落ちる**。

何を守っているかは `../CONTRACT.md` の「テスト用の固定物」を参照。
