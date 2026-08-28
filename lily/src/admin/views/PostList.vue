<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { isoDate } from '../../../../shared/date.ts';
import { client, errorMessage, MOUNT } from '../api.ts';
import { go } from '../router.ts';

type Post = {
  publicId: string;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  canonicalPath: string;
  url: string;
};

/** 1 ページの件数。API 側の上限は 100。 */
const PER_PAGE = 30;

const posts = ref<Post[]>([]);
const total = ref(0);
const offset = ref(0);
const status = ref<'' | 'draft' | 'published'>('');
const error = ref('');
const loading = ref(true);

const hasPrev = computed(() => offset.value > 0);
const hasNext = computed(() => offset.value + posts.value.length < total.value);
const range = computed(() =>
  total.value === 0 ? '0 件' : `${offset.value + 1}–${offset.value + posts.value.length} / ${total.value} 件`,
);

async function load(): Promise<void> {
  loading.value = true;
  const res = await client.posts.$get({
    query: {
      limit: String(PER_PAGE),
      offset: String(offset.value),
      ...(status.value === '' ? {} : { status: status.value }),
    },
  });
  if (!res.ok) {
    error.value = await errorMessage(res);
  } else {
    const body = await res.json();
    posts.value = body.posts;
    total.value = body.total;
    error.value = '';
  }
  loading.value = false;
}

function move(step: number): void {
  offset.value = Math.max(0, offset.value + step * PER_PAGE);
}

// 絞り込みを変えたら先頭のページに戻す。3 ページ目で絞ると空に見えるため。
watch(status, () => {
  offset.value = 0;
});
watch([offset, status], load);

onMounted(load);

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
    <h1>lily</h1>
    <select v-model="status" class="filter">
      <option value="">すべて</option>
      <option value="published">公開</option>
      <option value="draft">下書き</option>
    </select>
    <span class="spacer" />
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
    <button class="primary" @click="go('/posts/new')">新規</button>
  </header>

  <p v-if="error" class="notice error">{{ error }}</p>
  <p v-else-if="loading" class="muted">読み込み中…</p>
  <p v-else-if="posts.length === 0" class="muted">
    {{ status === '' ? 'まだ記事がありません。' : 'この状態の記事はありません。' }}
  </p>

  <div v-for="post in posts" :key="post.publicId" class="post-row">
    <span class="badge" :class="post.status">{{ post.status === 'published' ? '公開' : '下書き' }}</span>
    <a class="title" href="#" @click.prevent="go(`/posts/${post.publicId}`)">{{ post.title }}</a>
    <!-- パスを決めていない記事は canonical が public_id そのもの。uuid を並べても
         読めないので出さない。 -->
    <span v-if="post.canonicalPath !== post.publicId" class="path">/{{ post.canonicalPath }}/</span>
    <span class="spacer" />
    <span class="muted">{{ day(post.publishedAt) }}</span>
  </div>

  <div v-if="!loading && total > 0" class="pager">
    <button :disabled="!hasPrev" @click="move(-1)">← 前</button>
    <span class="muted">{{ range }}</span>
    <button :disabled="!hasNext" @click="move(1)">次 →</button>
  </div>
</template>
