/**
 * ブラウザで動かす小さなスクリプト。ページに直書きする。
 *
 * **`STORAGE_KEY` は `shared/theme.ts` から埋め込む。** ここがずれると
 * `/` と `/blog/` を行き来したときにテーマの選択が引き継がれない。逆に言うと、
 * 埋め込んでいるのはそれだけで、判定そのもの (次のテーマ・初期値・保存の
 * try/catch) はこの文字列の中に短く書き直してある。**この 20 行を守るのは
 * `e2e/` のテーマの節**で、ブラウザで実際に動かして確かめる。
 */
import { STORAGE_KEY } from '../../../shared/theme.ts';

const KEY = JSON.stringify(STORAGE_KEY);

/**
 * 保存済みのテーマを**描画前に** stamp する。`<head>` に置くこと。
 * 遅らせると、OS 設定と違うテーマを選んだ訪問者に一瞬ちらつきが出る。
 */
export const THEME_INIT =
  `try{var t=localStorage.getItem(${KEY});` +
  `if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * トグルボタンの挙動。
 *
 * アイコンの出し分けは CSS が `:root[data-theme]` で行うので、ここが持つのは
 * `data-theme` の書き換えと保存、それとラベルの更新だけ。
 *
 * OS 設定に追従するかは保存値ではなく `chosen` フラグで見る。`getItem` は通るのに
 * `setItem` だけ throw する環境 (Safari プライベートモード) で、保存に失敗した
 * ユーザーの選択を OS 側の変更に奪われないため。
 */
export const THEME_TOGGLE = `(function(){
var K=${KEY},root=document.documentElement,button=document.querySelector('.theme-toggle');
if(!button)return;
var mql=window.matchMedia('(prefers-color-scheme: dark)');
function read(){try{return localStorage.getItem(K)}catch(e){return null}}
function write(v){try{localStorage.setItem(K,v)}catch(e){}}
var stored=read(),chosen=stored==='light'||stored==='dark';
var theme=chosen?stored:(mql.matches?'dark':'light');
function apply(t){theme=t;root.dataset.theme=t;
var label=(t==='dark'?'ライト':'ダーク')+'テーマに切り替え';
button.setAttribute('aria-label',label);button.title=label}
apply(theme);
button.addEventListener('click',function(){chosen=true;var next=theme==='dark'?'light':'dark';write(next);apply(next)});
mql.addEventListener('change',function(e){if(!chosen)apply(e.matches?'dark':'light')});
})();`;
