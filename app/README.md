# app.fushihara.net（自分用サービスのランチャー）

自分用のサービスへのリンクを並べた画面。Cloudflare Access で自分だけが開ける。
スマートフォンのホーム画面に置いて使う（issue #56）。

本体（`fushihara-net`）ともブログ（`fushihara-blog`）とも別の Worker
`fushihara-app` で、静的アセットだけを配る。Worker のスクリプトは無い。

## サービスを足す

1. 各サービスの favicon（SVG）を `icons/<id>.svg` に置く
2. `services.ts` の `SERVICES` に 1 件足す（複製元をコメントに書く）

**直すのは `services.ts` だけ。** `index.html` はビルドがそこから作る。

アイコンを複製して持つのは、各サービスが Access の内側にあり、favicon も
未ログインでは取れないため。Access の Cookie はホスト名ごとなので、ランチャーに
ログインしていても、ほかのホストの画像を直接読むとログイン画面へリダイレクトされる。
**複製元のアイコンを変えたら、こちらも差し替える。**

## コマンド

```bash
npm install
npm run build      # services.ts から dist/ を作る（PNG のアイコンも SVG から起こす）
npm run dev        # build して wrangler dev（localhost:8790）
npm run typecheck
npm run test:e2e   # wrangler dev に対して回す（localhost:8789）
npm run deploy     # build して wrangler deploy
```

## Access とデプロイ

**アプリ側に認証は無い。** 入口は Custom Domain の `app.fushihara.net` だけにし
（`workers_dev` と `preview_urls` は閉じてある）、Access で守る。

- **初回のデプロイより前に Access のアプリを作る。** main への push で
  `.github/workflows/deploy-app.yml` がデプロイするので、先に push すると
  Access の無い状態で公開される
- **Destinations は `app.fushihara.net` の 1 つだけ。** 2 つ並べると、パスキーで
  ログインした後に先頭のホスト名へ戻される（ratatoskr で踏んだ）
- Login methods で Passkeys を有効にする

## ホーム画面に追加する

**ログインしてから追加する。** manifest とアイコンも Access の内側にあるので、
未ログインで追加すると、それらがログイン画面へのリダイレクトになり、アイコンの無い
ショートカットになる。manifest は Cookie を付けて取らせている
（`<link rel="manifest" crossorigin="use-credentials">`。外すと同じ origin でも
Cookie が送られない）。

- iPhone: Safari で開き、共有 → ホーム画面に追加（`apple-touch-icon.png`）
- Android: Chrome で開き、メニュー → ホーム画面に追加（`manifest.webmanifest`）

ホーム画面から開いた画面（standalone）は、ほかのホストへ移ると端末のアプリ内
ブラウザで開く。Access のログイン（`kanf.cloudflareaccess.com`）も同じ。
