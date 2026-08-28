# 切り替え手順（`/blog-next` → `/blog`）

並走中の lily を本番の `/blog` に据え、Astro を下ろすまでの手順。

**この文書は作業のたびに書き換える。** 済んだ手順を消すのではなく、実際に起きたこと
（想定と違った点・追加で要った操作）を追記すること。次に同じことをするのは
「OSS として配った lily を誰かが別サイトに載せるとき」で、そのとき効くのは
きれいな手順ではなく**踏んだ穴の記録**の方。

## 原則

1. **Access を route より先に広げる。** 逆順にすると、lily が `/blog*` を取った瞬間に
   公開ブログが Access の内側に入る。**2026-08-28 に実際に起こした事故**（並走の
   route を張る前に Access のパスを `blog` にしてしまい、現行ブログを RSS ごと
   読者から締め出した）と同じ形なので、順序を守ること
2. **各段でロールバックできる状態を保つ。** Astro の Worker とビルド成果物は
   切り替え後も数日残す。消すのは最後
3. **記事データは触らない。** `body_html` は mount を知らず、URL は `post_paths` に
   あるので、`MOUNT_PATH` を変えるだけで `/blog/...` になる。移行も再描画も要らない

## 先に読む落とし穴

- **Access のパスはワイルドカード無しだと前方一致。** `blog` と書くと `/blog` だけで
  なく `/blog-next` も掴む（実測）。だから**バラの `blog` を絶対に指定しない**。
  逆にワイルドカード（`blog/admin/*`）は `/blog/admin` 自身に当たらない（[docs](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)）ので、
  管理画面の入口を守るなら**ワイルドカード無しの `blog/admin`** を使う
- **同じ route を 2 つの Worker が持てない。** Astro から外してから lily に付ける
  という順序が強制され、**その間 `/blog*` は本体 Worker に落ちて 404 になる**
  （素の 404。`dist/404.html` が無いため）。デプロイ 1 回ぶんなので分単位
- **`ACCESS_AUD` は 1 つしか持てない。** `core/auth/access.ts` が単一の aud で
  検証するので、**Access のアプリを 2 つに分けない**。1 つのアプリに
  `/blog/admin` と `/blog/api` の 2 本を持たせる（AUD はアプリ単位）
- **旧 `/blog/_astro/*` は 404 になる。** 配信済みの RSS に入っている画像 URL が
  これなので、購読者のリーダーで過去記事の画像が消える。記事ページ側は
  `/blog/media/...` に変わるので影響しない
- **RSS の `guid` は記事の URL のまま**で、URL も変わらないので、購読者に全記事が
  「新着」として配り直されることはない。**`guid` を `urn:uuid:` に変えないこと**

## 0. 事前確認

```bash
# 現行 /blog の URL を全部控える（切り替え後に全て 200 になることを見る）
curl -s https://fushihara.net/blog/sitemap-0.xml \
  | grep -o '<loc>[^<]*</loc>' | sed -e 's/<[^>]*>//g' | sort > /tmp/before-urls.txt
wc -l /tmp/before-urls.txt
```

- [ ] `/blog-next` の記事数が現行と一致している
- [ ] `/tmp/before-urls.txt` の各 URL が `/blog` を `/blog-next` に読み替えて 200 になる
- [ ] 本体サイトの Blog 付箋（`/api/blog`）が今どう見えているかを控える

## 1. Access を先に広げる

Zero Trust の Access アプリ（AUD `5f36e8…d542`）に **public hostname を 2 本足す**。
既にある `blog-next` の行は**まだ消さない**（並走を止めるまで必要）。

| Subdomain | Domain | Path |
|---|---|---|
| （空） | fushihara.net | `blog/admin` |
| （空） | fushihara.net | `blog/api` |
| （空） | fushihara.net | `blog-next` ← 後始末で消す |

**`blog` とだけ書かない。** 公開ブログごと締め出す。

確認（Astro がまだ `/blog` を配っている状態で）:

```bash
# 公開側は素通しのまま（302 になったら Access のパスが広すぎる。すぐ戻す）
curl -s -o /dev/null -w '%{http_code}\n' https://fushihara.net/blog/
curl -s -o /dev/null -w '%{http_code}\n' https://fushihara.net/blog/rss.xml
```

- [ ] `/blog/` と `/blog/rss.xml` が 200 のまま
- [ ] `/blog-next/` は 302（Access）のまま

## 2. route の差し替え

**ここから `/blog*` が落ちる。** 2 つのデプロイを続けて行う。

```bash
# 2-1. Astro から route を外す
#      blog/wrangler.jsonc の "routes" を削除してから
cd blog && npx wrangler deploy -c ./wrangler.jsonc

# 2-2. lily を /blog* に載せ替える
#      lily/wrangler.jsonc  routes: fushihara.net/blog*
#      lily/src/site/meta.ts MOUNT_PATH = '/blog'
cd ../lily && npm run typecheck && npm test && npm run test:e2e
npm run build && npx wrangler deploy -c ./wrangler.jsonc
```

- [ ] `MOUNT_PATH` と `routes` を**セットで**変えた（片方だけだと 404 になる）
- [ ] E2E が `/blog` で通る（mount は `meta.ts` の 1 行から引いている）

確認:

```bash
while read -r u; do printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' "$u")"; echo "$u"; done < /tmp/before-urls.txt
curl -s https://fushihara.net/blog/rss.xml | grep -c '<item>'
curl -s -o /dev/null -w '%{http_code}\n' https://fushihara.net/blog/favicon/
```

- [ ] `/tmp/before-urls.txt` が**全部 200**
- [ ] RSS の件数が切り替え前と同じ
- [ ] 画像（`/blog/media/...`）が出る
- [ ] `/blog/admin/` が Access のログインへ飛び、ログインすると開く
- [ ] `/blog/` が Access に**掛からない**

## 3. 本体の service binding と `/api/blog`

本体サイトの Blog 付箋は今 RSS を正規表現で読んでいる。lily には `posts.json` が
あるので、そちらへ移す。

- `wrangler.jsonc`: `services` の `BLOG` を `fushihara-net-lily` へ
- `worker/api.ts`:
  - `BLOG_RSS_URL` → `https://fushihara.net/blog/posts.json`
  - `parseRssItems` / `decodeXml` / `TAG_RE` / `tagText` を**まるごと削除**
  - `posts.json` の `{ id, title, url, published_at, description, tags }` を
    `{ title, link, date }` に写す（`url` → `link`、`published_at` → `date`）
  - **`/api/blog` の外向きの形（`count` と `{title, link, date}`）は変えない。**
    `src/api.ts` もキャッシュキーの `keyParams` も触らずに済む
  - `count` は `posts.json` の `limit` にそのまま渡せる（既定 5・上限 20 で同じ）
  - **0 件を 502 にする扱いは残す。** 空の応答を 30 日の控えに書くと、上流が
    直っても付箋が「Loading...」で固定される
- `test/worker.test.ts`: `/api/blog` のスタブを RSS から JSON に差し替える

```bash
npm run typecheck && npm test && npm run test:e2e && npm run deploy
```

- [ ] 本体の Blog 付箋に記事が出る（`/api/blog` を直接叩いて確認）
- [ ] `blog/CONTRACT.md` の RSS の節（本体が正規表現で読む前提）が**要らなくなった**
      ことを CONTRACT.md 側に反映する

## 4. 数日おく

**ここで止めて様子を見る。** Astro の Worker と `blog/` はまだ消さない。

- [ ] 検索の登録が保たれている（URL は変わっていないので原則そのまま）
- [ ] 購読者のリーダーで記事が重複していない
- [ ] 管理画面から記事を 1 本書いて、公開まで通る（dogfood）

## 5. 後始末

- [ ] Access のアプリから `blog-next` の行を削除
- [ ] `fushihara-net-blog` Worker を削除
- [ ] `blog/` を削除し、`lily/` を `blog/` に改名
      （`lily/wrangler.jsonc` の `name` と CI の working-directory も一緒に）
- [ ] `.github/workflows/deploy-blog.yml` を削除、`lily.yml` を `deploy-blog.yml` に寄せる
- [ ] ルートの `CLAUDE.md` の route の節を書き換える
- [ ] `blog/CONTRACT.md` を書き換える（issue #5 の最後の項目）
- [ ] `lily/README.md` の「`/blog-next` での並走」の節を畳む

## ロールバック

`body_html` も `post_paths` も mount を知らないので、**戻すのは配線だけ**。

| いつ | 何をする |
|---|---|
| 手順 1 で公開側が 302 になった | Access のパスから広すぎる行を消す（それだけで戻る） |
| 手順 2 で `/blog` が壊れた | lily の route を `/blog-next*` に戻して deploy → Astro に `/blog*` を戻して deploy |
| 手順 3 で付箋が空になった | `services` の `BLOG` を `fushihara-net-blog` に戻して deploy |

**D1 と R2 は触らない。** 戻しても記事は消えない。
