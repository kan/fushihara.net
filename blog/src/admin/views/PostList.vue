<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { isoDate } from '../../../../shared/date.ts';
import { client, errorMessage, MOUNT } from '../api.ts';
import { go, NEW_POST_ROUTE, postRoute } from '../router.ts';
import { SITE } from '../site.ts';

type Post = {
  publicId: string;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  canonicalPath: string;
  url: string;
  tags: { name: string; slug: string }[];
};

/** 1 ページの件数。API 側の上限は 100。 */
const PER_PAGE = 30;

/**
 * 検索語を確定させるまでの待ち。1 文字ごとに投げると、日本語の変換中に
 * 中間の読み (`ke` `けん` …) で検索してしまう。
 */
const TYPING_PAUSE = 250;

/**
 * 絞り込み。**1 つのオブジェクトにまとめてある。**
 *
 * 別々の ref にすると、項目を 1 つ足すたびに「クエリの組み立て」「絞り込み中か」
 * 「解除」「ページを戻す watch」「読み直す watch」の 5 箇所へ同じ名前を書き足す
 * ことになる。どれか 1 つを落とすと、解除しても消えない項目や、絞ったのに
 * 3 ページ目のままになる項目ができる。
 */
const EMPTY = { status: '' as '' | 'draft' | 'published', tag: '', q: '' };
const filters = reactive({ ...EMPTY });

const posts = ref<Post[]>([]);
const total = ref(0);
const offset = ref(0);
/** 検索欄の値。これがそのまま飛ぶのではなく、少し置いてから `filters.q` に移る。 */
const typed = ref('');
const tagOptions = ref<{ name: string; slug: string; count: number }[]>([]);
const error = ref('');
const tagsError = ref('');
const loading = ref(true);

/**
 * 選択欄に出すタグ。**いま絞り込んでいる slug が無ければ足す。**
 *
 * 行のタグを押した直後や `/tags` が読めなかったときに、一覧は絞られているのに
 * 選択欄が「すべてのタグ」を指したままになる (絞り込み条件が画面から読めない)。
 */
const tagChoices = computed(() => {
  const options = tagOptions.value;
  const slug = filters.tag;
  if (slug === '' || options.some((option) => option.slug === slug)) return options;
  return [{ name: slug, slug, count: 0 }, ...options];
});

const filtered = computed(() => Object.values(filters).some((value) => value !== ''));
const hasPrev = computed(() => offset.value > 0);
const hasNext = computed(() => offset.value + posts.value.length < total.value);
const range = computed(() =>
  total.value === 0 ? '0 件' : `${offset.value + 1}–${offset.value + posts.value.length} / ${total.value} 件`,
);

/**
 * 最後に投げた読み込みの番号。**追い越した古い結果を捨てるため。**
 *
 * 検索は本文への LIKE 全走査なので、短い語ほど遅くなる。「早」の結果が
 * 「早朝」の結果より後に返ると、入力欄と一覧が食い違ったまま固まる。
 */
let latest = 0;

async function load(): Promise<void> {
  const token = ++latest;
  loading.value = true;
  const res = await client.posts.$get({
    query: {
      limit: String(PER_PAGE),
      offset: String(offset.value),
      // 空文字を「絞り込み無し」と読むのは API 側 (`core/api/schema.ts` の
      // `filterWord`)。ここでも同じ判断をすると、規則が 2 箇所になる。
      tag: filters.tag,
      q: filters.q,
      // status だけは enum なので空文字を渡せない。
      ...(filters.status === '' ? {} : { status: filters.status }),
    },
  });
  const body = res.ok ? await res.json() : null;
  const message = body ? '' : await errorMessage(res);

  // 読み終わるまでの間に次の読み込みが始まっていたら、こちらは捨てる。
  if (token !== latest) return;

  if (body) {
    posts.value = body.posts;
    total.value = body.total;
  }
  error.value = message;
  loading.value = false;
}

/**
 * 絞り込みの選択肢。**下書きしか無いタグは 0 件と出る** (件数は公開記事の数)。
 *
 * 失敗を黙って捨てない。捨てると選択欄が「すべてのタグ」だけになり、なぜ選べない
 * のかが画面に出ない。
 */
async function loadTags(): Promise<void> {
  const res = await client.tags.$get();
  if (res.ok) {
    tagOptions.value = (await res.json()).tags;
    tagsError.value = '';
  } else {
    tagsError.value = await errorMessage(res);
  }
}

function move(step: number): void {
  offset.value = Math.max(0, offset.value + step * PER_PAGE);
}

function clearFilters(): void {
  Object.assign(filters, EMPTY);
  typed.value = '';
}

let typingTimer: ReturnType<typeof setTimeout> | undefined;

watch(typed, (value) => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    filters.q = value.trim();
  }, TYPING_PAUSE);
});

// 打ち終える前に画面を離れたときに、消えたコンポーネントの ref を触らせない。
onUnmounted(() => clearTimeout(typingTimer));

// 絞り込みを変えたら先頭のページに戻す。3 ページ目で絞ると空に見えるため。
watch(filters, () => {
  offset.value = 0;
});
watch([offset, filters], load);

onMounted(() => {
  void load();
  void loadTags();
});

/**
 * 表示は日付まで。時刻の細かさは一覧で要らない。
 *
 * **JST で切り出す。** `published_at` は UTC の ISO8601 なので、頭を 10 文字
 * 取ると 9 時間ぶんずれる（JST の 0:00〜8:59 に公開した記事が前日として並ぶ。
 * 公開ページと編集画面は JST なので、一覧だけ 1 日違うことになる。実際に踏んだ）。
 */
function day(value: string | null): string {
  return value ? isoDate(new Date(value)) : '—';
}
</script>

<template>
  <header class="bar">
    <h1>{{ SITE.name }}</h1>
    <span class="spacer" />
    <a href="#/settings">設定</a>
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
    <button class="primary" @click="go(NEW_POST_ROUTE)">新規</button>
  </header>

  <div class="filters">
    <input
      v-model="typed"
      type="search"
      class="search"
      placeholder="タイトル・説明・本文を検索"
      aria-label="記事を検索"
    />
    <select v-model="filters.status" class="filter" aria-label="状態で絞り込む">
      <option value="">すべての状態</option>
      <option value="published">公開</option>
      <option value="draft">下書き</option>
    </select>
    <select v-model="filters.tag" class="filter" aria-label="タグで絞り込む">
      <option value="">すべてのタグ</option>
      <option v-for="option in tagChoices" :key="option.slug" :value="option.slug">
        {{ option.name }}（{{ option.count }}）
      </option>
    </select>
    <button v-if="filtered" @click="clearFilters">絞り込みを解除</button>
  </div>

  <p v-if="tagsError" class="notice error">タグの一覧を読めなかった: {{ tagsError }}</p>
  <p v-if="error" class="notice error">{{ error }}</p>
  <p v-else-if="loading" class="muted">読み込み中…</p>
  <p v-else-if="posts.length === 0" class="muted">
    {{ filtered ? 'この条件の記事はありません。' : 'まだ記事がありません。' }}
  </p>

  <div v-for="post in posts" :key="post.publicId" class="post-row">
    <span class="badge" :class="post.status">{{ post.status === 'published' ? '公開' : '下書き' }}</span>
    <a class="title" href="#" @click.prevent="go(postRoute(post.publicId))">{{ post.title }}</a>
    <!-- パスを決めていない記事は canonical が public_id そのもの。uuid を並べても
         読めないので出さない。 -->
    <span v-if="post.canonicalPath !== post.publicId" class="path">/{{ post.canonicalPath }}/</span>
    <span class="spacer" />
    <!-- 押すとそのタグで絞り込む。選択欄まで目を移さずに辿れる。 -->
    <button
      v-for="postTag in post.tags"
      :key="postTag.slug"
      class="chip"
      :aria-label="`${postTag.name} で絞り込む`"
      @click="filters.tag = postTag.slug"
    >
      {{ postTag.name }}
    </button>
    <span class="muted">{{ day(post.publishedAt) }}</span>
  </div>

  <div v-if="!loading && total > 0" class="pager">
    <button :disabled="!hasPrev" @click="move(-1)">← 前</button>
    <span class="muted">{{ range }}</span>
    <button :disabled="!hasNext" @click="move(1)">次 →</button>
  </div>
</template>
