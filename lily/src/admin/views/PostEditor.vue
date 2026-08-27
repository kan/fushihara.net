<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fromDateTimeInput, toDateTimeInput } from '../../../../shared/date.ts';
import { client, errorMessage, MOUNT } from '../api.ts';
import { go } from '../router.ts';
import DateTimeInput from './DateTimeInput.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import TagInput from './TagInput.vue';

const props = defineProps<{ publicId: string | null }>();

type Detail = {
  publicId: string;
  title: string;
  description: string | null;
  bodyMd: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  hasPreview: boolean;
  canonicalPath: string;
  url: string;
  paths: { path: string; isCanonical: boolean }[];
  tags: { name: string; slug: string }[];
  media: { publicId: string; filename: string; url: string }[];
};

const post = ref<Detail | null>(null);
const title = ref('');
const description = ref('');
const tags = ref<string[]>([]);
const bodyMd = ref('');
const newPath = ref('');
const previewUrl = ref('');
/** 公開日時。`YYYY-MM-DDTHH:mm`（JST の裸の日時）。空は「指定なし」。 */
const publishedAt = ref('');

const html = ref('');
const unresolved = ref<readonly string[]>([]);
const error = ref('');
const busy = ref(false);

const saved = computed(() => props.publicId !== null);

function fill(detail: Detail): void {
  post.value = detail;
  title.value = detail.title;
  description.value = detail.description ?? '';
  tags.value = detail.tags.map((tag) => tag.name);
  bodyMd.value = detail.bodyMd;
  newPath.value = detail.canonicalPath;
  publishedAt.value =
    detail.publishedAt === null ? '' : toDateTimeInput(new Date(detail.publishedAt));
}

/**
 * 失敗を画面に出して null を返す。
 *
 * **絞り込みをまたぐ汎用ヘルパーは作らない。** `hc` の戻り値は成功・API の
 * エラー・zod の検証失敗の union で、`if (!res.ok)` で絞ったところに型が付く。
 * ジェネリックな関数で包むとその情報が消える。
 */
async function fail(res: { status: number; json: () => Promise<unknown> }): Promise<void> {
  error.value = await errorMessage(res);
}

/** 通信中の印を立てる。 */
async function run(work: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } finally {
    busy.value = false;
  }
}

async function load(): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].$get({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function save(): Promise<void> {
  const json = {
    title: title.value,
    description: description.value,
    bodyMd: bodyMd.value,
    tags: tags.value,
    // 下書きでも設定できる。公開のときに coalesce でこの日時が使われるので、
    // 「公開日を先に決めておく」「昔の記事を移す」がそのまま通る。
    // 空なら送らない (= 変えない)。公開中の記事から日付を消すのは
    // 「取り下げる」の仕事。
    ...(publishedAt.value === ''
      ? {}
      : { publishedAt: fromDateTimeInput(publishedAt.value) ?? undefined }),
  };
  const id = props.publicId;

  await run(async () => {
    if (id === null) {
      const res = await client.posts.$post({ json });
      if (!res.ok) return await fail(res);
      const created = await res.json();
      unresolved.value = created.unresolvedMedia;
      fill(created.post);
      go(`/posts/${created.post.publicId}`);
      return;
    }
    const res = await client.posts[':publicId'].$patch({ param: { publicId: id }, json });
    if (!res.ok) return await fail(res);
    const updated = await res.json();
    unresolved.value = updated.unresolvedMedia;
    fill(updated.post);
  });
}

async function setStatus(action: 'publish' | 'unpublish'): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res =
      action === 'publish'
        ? await client.posts[':publicId'].publish.$post({ param: { publicId: id }, json: {} })
        : await client.posts[':publicId'].unpublish.$post({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function changePath(): Promise<void> {
  const id = props.publicId;
  if (id === null || post.value === null || newPath.value === post.value.canonicalPath) return;
  await run(async () => {
    const res = await client.posts[':publicId'].path.$put({
      param: { publicId: id },
      json: { path: newPath.value },
    });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function removeAlias(path: string): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].paths.$delete({
      param: { publicId: id },
      json: { path },
    });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function issuePreview(): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].preview.$post({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    // API が返すのは mount 相対のパス。共有できる URL は、管理画面が動いて
    // いるオリジンと繋いで作る (本番でも手元でも、そのまま開ける形になる)。
    previewUrl.value = `${location.origin}${(await res.json()).path}`;
    if (post.value) post.value = { ...post.value, hasPreview: true };
  });
}

async function revokePreview(): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].preview.$delete({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    previewUrl.value = '';
    if (post.value) post.value = { ...post.value, hasPreview: false };
  });
}

async function remove(): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  if (!confirm('この記事を消す。元に戻せない。')) return;
  await run(async () => {
    const res = await client.posts[':publicId'].$delete({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    go('/');
  });
}

/**
 * 画像を上げてファイル名を返す。本文に入るのは `./<filename>`。
 *
 * multipart なので `hc` の型付き呼び出しは使えない (検証を zod に通していない)。
 * URL の組み立てだけ `$url()` に任せて、パスを 2 箇所に書かないようにする。
 */
async function upload(file: File): Promise<string | null> {
  const id = props.publicId;
  if (id === null) {
    error.value = '先に保存してから画像を入れる（どの記事の添付か決まらないため）';
    return null;
  }

  const form = new FormData();
  form.append('file', file);

  let filename: string | null = null;
  await run(async () => {
    const url = client.posts[':publicId'].media.$url({ param: { publicId: id } });
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) return await fail(res);

    const uploaded = (await res.json()) as { media: Detail['media'][number] };
    filename = uploaded.media.filename;

    // **ここで load() を呼ばない。** 本文まで読み直すと textarea の value が
    // 代入し直され、カーソルが末尾へ飛ぶ (画像がそこに入ってしまう)。
    // 増えたのは添付だけなので、その 1 件だけを足す。
    if (post.value) post.value = { ...post.value, media: [...post.value.media, uploaded.media] };
  });
  return filename;
}

async function removeMedia(mediaId: string): Promise<void> {
  await run(async () => {
    const res = await client.media[':publicId'].$delete({ param: { publicId: mediaId } });
    if (!res.ok) return await fail(res);

    // 消したときも本文は読み直さない (書きかけを捨てないため)。
    if (post.value) {
      post.value = {
        ...post.value,
        media: post.value.media.filter((item) => item.publicId !== mediaId),
      };
    }
  });
}

/**
 * プレビュー。**公開ページと同じ renderer を通す**ので、書きながら見ているものと
 * 出るものが食い違わない。打つたびに投げないよう少し待つ。
 */
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  bodyMd,
  (value) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await client.render.$post({
        json: { bodyMd: value, ...(props.publicId === null ? {} : { publicId: props.publicId }) },
      });
      if (!res.ok) return;
      const rendered = await res.json();
      html.value = rendered.html;
      unresolved.value = rendered.unresolvedMedia;
    }, 300);
  },
  { immediate: true },
);

onMounted(load);
</script>

<template>
  <header class="bar">
    <button @click="go('/')">← 一覧</button>
    <h1>{{ saved ? '編集' : '新規' }}</h1>
    <span v-if="post" class="badge" :class="post.status">
      {{ post.status === 'published' ? '公開' : '下書き' }}
    </span>
    <span class="spacer" />
    <a v-if="post && post.status === 'published'" :href="post.url" target="_blank" rel="noreferrer">
      公開ページ
    </a>
    <button class="primary" :disabled="busy" @click="save">保存</button>
  </header>

  <p v-if="error" class="notice error">{{ error }}</p>
  <p v-if="unresolved.length" class="notice">
    解決できない画像の参照: {{ unresolved.join(', ') }}
  </p>

  <!-- 上段: 記事そのものではなく「記事についての情報」。ここが動くと本文の
       縦位置がずれるので、本文とプレビューより上にまとめて置く。 -->
  <div class="meta">
    <label class="wide">
      タイトル
      <input v-model="title" type="text" />
    </label>
    <label class="wide">
      説明（一覧と OGP に出る）
      <input v-model="description" type="text" />
    </label>
    <label>
      タグ
      <TagInput v-model="tags" />
    </label>
    <label>
      {{ post?.status === 'published' ? '公開日時' : '公開日時（公開するとこの日時になる）' }}
      <DateTimeInput v-model="publishedAt" />
    </label>
    <label v-if="post" class="wide">
      公開パス（変えると旧パスは自動で alias に残る）
      <span class="path-row">
        <input v-model="newPath" type="text" @keyup.enter="changePath" />
        <button :disabled="busy || newPath === post.canonicalPath" @click="changePath">変える</button>
      </span>
    </label>
  </div>

  <!-- 本文とプレビューは同じ高さで並べる。書いている行と出来上がりを
       見比べられるようにするため。 -->
  <div class="editor">
    <div class="panel">
      <h2>本文</h2>
      <MarkdownEditor v-model="bodyMd" :upload="upload" />
    </div>
    <div class="panel">
      <h2>プレビュー</h2>
      <!-- 本文は自分で書いたものを自分で描いたもの。 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="preview" v-html="html" />
    </div>
  </div>

  <!-- 下段: 書き終わってから触るもの。 -->
  <template v-if="post">
    <div class="panels">
      <div class="panel">
        <h2>URL</h2>
        <ul class="paths">
          <li v-for="path in post.paths" :key="path.path">
            <span>/{{ path.path }}/</span>
            <span v-if="path.isCanonical" class="badge">canonical</span>
            <span class="spacer" />
            <button v-if="!path.isCanonical && path.path !== post.publicId" @click="removeAlias(path.path)">
              消す
            </button>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>添付</h2>
        <ul class="media-list">
          <li v-for="item in post.media" :key="item.publicId">
            <span class="name">{{ item.filename }}</span>
            <span class="spacer" />
            <a :href="item.url" target="_blank" rel="noreferrer">開く</a>
            <button class="danger" @click="removeMedia(item.publicId)">消す</button>
          </li>
        </ul>
        <p v-if="post.media.length === 0" class="muted">まだ無い。</p>
      </div>

      <div class="panel">
        <h2>下書きプレビュー</h2>
        <p class="muted">URL を知っている人だけが下書きを読める。検索には載らない。</p>
        <p v-if="previewUrl" class="notice">
          {{ previewUrl }}
          <span class="muted">（この URL が出るのは発行したときだけ）</span>
        </p>
        <div class="actions">
          <button :disabled="busy" @click="issuePreview">
            {{ post.hasPreview ? '発行し直す' : '発行する' }}
          </button>
          <button v-if="post.hasPreview" :disabled="busy" @click="revokePreview">失効させる</button>
        </div>
      </div>
    </div>

    <div class="actions" style="margin-top: 1rem">
      <button v-if="post.status === 'draft'" :disabled="busy" @click="setStatus('publish')">
        公開する
      </button>
      <button v-else :disabled="busy" @click="setStatus('unpublish')">取り下げる</button>
      <span class="spacer" />
      <button class="danger" :disabled="busy" @click="remove">削除</button>
    </div>
  </template>
  <p v-else class="muted" style="margin-top: 1rem">
    保存すると URL・添付・プレビューを設定できる。
  </p>

  <p class="muted" style="margin-top: 2rem">
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
  </p>
</template>
