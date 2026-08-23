#!/usr/bin/env bash
# 記事が読み込まれる形になっているかを確かめる。
#
# 読み込み条件は `**/index.md` なので、`posts/my-post.md` のような直置きや、記事の隣に
# 置いた `notes.md` は黙って無視される。ビルドは成功するのに記事が出ないという、
# 一番デバッグしづらい形になるので、ここで止める。
set -euo pipefail

cd "$(dirname "$0")/.."

root="${BLOG_CONTENT_DIR:-./content/posts}"
[ -d "$root" ] || { echo "$root がありません" >&2; exit 1; }

stray=()
while IFS= read -r file; do
  [ "$(basename "$file")" = 'index.md' ] || stray+=("$file")
done < <(find "$root" -type f -name '*.md')

if [ ${#stray[@]} -gt 0 ]; then
  echo "index.md ではない Markdown があります。これらは読み込まれません:" >&2
  printf '  %s\n' "${stray[@]}" >&2
  echo "記事にするなら <slug>/index.md にリネームしてください (blog/CONTRACT.md)。" >&2
  echo "記事ではないメモなら content/posts の外に出してください。" >&2
  exit 1
fi
