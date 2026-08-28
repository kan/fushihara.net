#!/usr/bin/env bash
# 配信物に E2E のフィクスチャが混ざっていないことを確かめる。
#
# content layer のストアは読み込み先ディレクトリを覚えていないので、BLOG_CONTENT_DIR を
# 切り替えた直後のビルドは前回の記事を引きずる (実測済み)。astro.config.mjs の cacheDir 分離と
# npm scripts の clean:build-store でそれを防いでいるが、そこが壊れたときに気付けるのは
# 公開されてからになる。デプロイの直前に見るのが最後の砦。
set -euo pipefail

cd "$(dirname "$0")/.."

# **フィクスチャを配ると分かっている場面では検査しない。**
# E2E は test-content/ に対してビルドして wrangler dev で配るので、そこで止めると
# テストが起動できない。デプロイの経路が BLOG_CONTENT_DIR を立てることはないので、
# 「素のビルドに混ざっていないか」という本来の問いはこれで保たれる。
if [ -n "${BLOG_CONTENT_DIR:-}" ]; then
  echo "BLOG_CONTENT_DIR が指定されているので検査しない ($BLOG_CONTENT_DIR)"
  exit 0
fi

dist_root='dist/blog'
[ -d "$dist_root" ] || { echo "$dist_root がありません。先にビルドしてください" >&2; exit 1; }

leaked=()
for dir in test-content/posts/*/; do
  slug=$(basename "$dir")
  if [ -e "$dist_root/$slug" ]; then
    leaked+=("$slug")
  fi
done

if [ ${#leaked[@]} -gt 0 ]; then
  echo "配信物に E2E のフィクスチャが混ざっています: ${leaked[*]}" >&2
  echo "cacheDir の分離か clean:build-store が効いていない可能性があります。" >&2
  echo "node_modules/.astro*/data-store.json を消して再ビルドしてください。" >&2
  exit 1
fi

echo "フィクスチャの混入なし"
