<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { client } from '../api.ts';
import { imageMarkdown } from '../../core/render/markdown.ts';
import Icon from './Icon.vue';

const props = defineProps<{
  modelValue: string;
  /**
   * ファイルを預けるとファイル名を返す。失敗したら null。
   * **本文に入れるのは `./<filename>` の相対参照**で、配信 URL は描画時に解決する。
   */
  upload: (file: File) => Promise<string | null>;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const area = ref<HTMLTextAreaElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(0);

const TABLE = ['| 見出し | 見出し |', '| --- | --- |', '| 中身 | 中身 |'].join('\n');

type Range = { start: number; end: number };

function selection(): Range {
  const el = area.value;
  return el ? { start: el.selectionStart, end: el.selectionEnd } : { start: 0, end: 0 };
}

/** 差し込んだあと、指定の範囲を選び直す。 */
function reselect(start: number, end: number): void {
  requestAnimationFrame(() => {
    const el = area.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  });
}

/**
 * 選択範囲を包む / カーソル位置に差し込む。
 *
 * `at` を渡すとその位置に入れる。**textarea の value を代入し直すとカーソルが
 * 末尾へ飛ぶ**ので、非同期の処理 (画像のアップロード) をまたぐときは、始める
 * 前に捕まえた位置を持ち回る必要がある。
 */
function surround(before: string, after = '', placeholder = '', at?: Range): void {
  const { start, end } = at ?? selection();
  const selected = props.modelValue.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  emit('update:modelValue', props.modelValue.slice(0, start) + inserted + props.modelValue.slice(end));
  // 差し込んだ中身を選び直す。続けて打てば置き換わる。
  reselect(start + before.length, start + before.length + selected.length);
}

/** 行頭に印を足す (見出し・引用・リスト)。 */
function prefixLine(mark: string): void {
  const el = area.value;
  if (!el) return;

  const value = props.modelValue;
  const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
  const at = el.selectionStart + mark.length;
  emit('update:modelValue', value.slice(0, lineStart) + mark + value.slice(lineStart));
  reselect(at, at);
}

/** 前後に空行を空けてブロックを差し込む (表・水平線)。 */
function insertBlock(text: string): void {
  const { start } = selection();
  const value = props.modelValue;
  const head = value.slice(0, start);
  const gap = head === '' || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n';
  surround(`${gap}${text}\n`, '', '');
}

/**
 * 脚注。本文に参照を置き、**定義は末尾に足す**。
 *
 * 番号は本文にある `[^n]` の最大値の次。定義の位置は末尾で固定でよい
 * (Markdown では定義がどこにあっても、出力は末尾にまとまる)。
 */
function insertFootnote(): void {
  const value = props.modelValue;
  const used = [...value.matchAll(/\[\^(\d+)\]/g)].map((matched) => Number(matched[1]));
  const number = used.length === 0 ? 1 : Math.max(...used) + 1;

  const { start } = selection();
  const withRef = `${value.slice(0, start)}[^${number}]${value.slice(start)}`;
  const gap = withRef.endsWith('\n') ? '\n' : '\n\n';
  const full = `${withRef}${gap}[^${number}]: `;

  emit('update:modelValue', full);
  // 定義の行末に置いて、そのまま中身を書けるようにする
  reselect(full.length, full.length);
}

/**
 * 画像を差し込む。
 *
 * **1 つ入れるごとに `nextTick` で props の更新を待つ。** 待たずに続けると
 * 古い本文を元に組み立てて、直前に入れたものを消してしまう。
 */
async function insertFiles(files: readonly File[], at?: Range): Promise<void> {
  let cursor = at ?? selection();

  for (const file of files) {
    const filename = await props.upload(file);
    if (filename === null) continue;

    // 記事と同じディレクトリのファイルとして参照する。mount 依存の URL は書かない。
    // 書き方 (空白を含むときの `<…>`) は renderer 側と対で core が持っている。
    const text = imageMarkdown(filename);
    const value = props.modelValue;
    emit('update:modelValue', value.slice(0, cursor.start) + text + value.slice(cursor.end));

    const next = cursor.start + text.length;
    cursor = { start: next, end: next };
    await nextTick();
  }
  reselect(cursor.start, cursor.end);
}

function imagesOf(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = 0;
  await insertFiles(imagesOf(event.dataTransfer?.files));
}

/**
 * 「その他」のメニュー。たまにしか使わない記法をここに畳む。
 *
 * 開いたあとに document の pointerdown で閉じる。**登録を 1 フレーム遅らせる**の
 * は、開くきっかけになった pointerdown でそのまま閉じないため。メニューの中は
 * `@pointerdown.stop` で伝播を止めてあるので、項目を選んでも先に閉じない。
 */
const menuOpen = ref(false);

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) return;
  requestAnimationFrame(() => {
    addEventListener('pointerdown', closeMenu, { once: true });
  });
}

function closeMenu(): void {
  menuOpen.value = false;
}

/** メニューから選んだら閉じてから入れる。 */
function fromMenu(run: () => void): void {
  closeMenu();
  run();
}

/** ボタンを押した時点のカーソル位置。ファイル選択のあいだ blur するので覚えておく。 */
let pickedAt: Range | undefined;

function openPicker(): void {
  pickedAt = selection();
  picker.value?.click();
}

async function onPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await insertFiles(imagesOf(input.files), pickedAt);
  // 同じファイルをもう一度選べるように空にしておく
  input.value = '';
}

/**
 * 貼り付け。
 *
 * - 画像 → アップロードして `![](./…)`
 * - URL  → タイトルを取ってきて `[タイトル](url)`。選択中ならその文字を題にする
 * - それ以外 → 既定の貼り付けに任せる
 */
async function onPaste(event: ClipboardEvent): Promise<void> {
  const images = imagesOf(event.clipboardData?.files);
  if (images.length > 0) {
    event.preventDefault();
    await insertFiles(images);
    return;
  }

  const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  if (!isHttpUrl(text)) return;

  event.preventDefault();
  const { start, end } = selection();
  const selected = props.modelValue.slice(start, end);

  // 取りに行くあいだも書き続けられるよう、まず URL のままの形で入れておく。
  // **surround には通さない。** あれは選択範囲を読み直して包むので、完成形を
  // 渡すと選んだ文字が後ろに二重で残る。
  const inserted = `[${selected || text}](${text})`;
  const pasted = props.modelValue.slice(0, start) + inserted + props.modelValue.slice(end);
  emit('update:modelValue', pasted);
  reselect(start + inserted.length, start + inserted.length);

  // 選んだ文字が題なら、取りに行く必要がない。
  if (selected !== '') return;

  const res = await client['link-title'].$post({ json: { url: text } });
  if (!res.ok) return;
  const { title } = await res.json();
  if (title === null) return;

  // **入れた場所を覚えておいて、そこだけ差し替える。** 本文から探して置き換えると、
  // 同じ URL を前にも貼っていたときに古い方が書き変わる。
  const current = props.modelValue;
  if (current.slice(start, start + inserted.length) !== inserted) return;

  const replaced = `[${title}](${text})`;
  emit(
    'update:modelValue',
    current.slice(0, start) + replaced + current.slice(start + inserted.length),
  );
  reselect(start + replaced.length, start + replaced.length);
}

function isHttpUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
</script>

<template>
  <!-- 似たものをまとめる。左から 見出し / インライン / ブロック / 箇条書き。 -->
  <div class="toolbar">
    <div class="group">
      <button type="button" @mousedown.prevent title="見出し" @click="prefixLine('## ')">H2</button>
      <button type="button" @mousedown.prevent title="小見出し" @click="prefixLine('### ')">H3</button>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="太字" @click="surround('**', '**', '太字')">
        <Icon name="bold" />
      </button>
      <button type="button" @mousedown.prevent title="斜体" @click="surround('*', '*', '斜体')">
        <Icon name="italic" />
      </button>
      <button type="button" @mousedown.prevent title="インラインコード" @click="surround('`', '`', 'code')">
        <Icon name="code" />
      </button>
      <button type="button" @mousedown.prevent title="リンク" @click="surround('[', '](https://)', 'リンク')">
        <Icon name="link" />
      </button>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="画像を入れる" @click="openPicker">
        <Icon name="image" />
      </button>
      <button type="button" @mousedown.prevent title="コードブロック" @click="surround('```ts\n', '\n```', '')">
        <Icon name="block" />
      </button>
      <button type="button" @mousedown.prevent title="引用" @click="prefixLine('> ')">
        <Icon name="quote" />
      </button>

      <div class="menu-wrap" @pointerdown.stop>
        <button
          type="button"
          @mousedown.prevent
          title="そのほかの記法"
          :class="{ on: menuOpen }"
          @click="toggleMenu"
          @keydown.escape="closeMenu"
        >
          <Icon name="more" />
        </button>
        <!-- 項目は button。li に click だけ付けるとキーボードで押せない。 -->
        <ul v-if="menuOpen" class="menu">
          <li>
            <button type="button" @click="fromMenu(() => insertBlock(TABLE))">
              <Icon name="table" /><span>表</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(() => insertBlock('---'))">
              <Icon name="rule" /><span>水平線</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(insertFootnote)">
              <Icon name="footnote" /><span>脚注</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="箇条書き" @click="prefixLine('- ')">
        <Icon name="list" />
      </button>
      <button type="button" @mousedown.prevent title="番号付きリスト" @click="prefixLine('1. ')">
        <Icon name="ordered-list" />
      </button>
    </div>

    <input ref="picker" type="file" accept="image/*" multiple hidden @change="onPick" />
  </div>

  <div
    class="dropzone"
    :class="{ over: dragging > 0 }"
    @dragenter.prevent="dragging++"
    @dragleave.prevent="dragging--"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <textarea
      ref="area"
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @paste="onPaste"
    />
  </div>
  <p class="muted">
    画像はドラッグ＆ドロップ・貼り付け・ボタンで入る。URL を貼るとタイトル付きのリンクになる。
  </p>
</template>
