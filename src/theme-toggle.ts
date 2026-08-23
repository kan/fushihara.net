import { isTheme, nextTheme, resolveInitialTheme, type Theme } from '../shared/theme';
import { readStoredTheme, writeStoredTheme } from '../shared/theme-storage';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// アイコンはボード外に置くので wema のサニタイザの制約を受けず、inline SVG が使える。
const SUN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;

function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function render(button: HTMLButtonElement, theme: Theme): void {
  // アイコンは現在のテーマを表し、ラベルは押した先を伝える
  // 代入するのは上のモジュール定数のみで、外部入力は一切混ざらない
  button.innerHTML = theme === 'dark' ? MOON : SUN;

  const label = nextTheme(theme) === 'dark' ? 'ダークテーマに切り替え' : 'ライトテーマに切り替え';
  button.setAttribute('aria-label', label);
  button.title = label;
}

/**
 * テーマを初期化し、右上に切り替えボタンを置く。
 * index.html のインラインスクリプトが先に data-theme を stamp しているので、
 * ここでの適用は保存値が無いケースの確定と、以降の操作の受け口が役割。
 */
export function initTheme(): void {
  const stored = readStoredTheme();
  let theme = resolveInitialTheme(stored, prefersDark());
  // 保存済みの選択も「明示的に選んだ」扱いにする。以降 OS 設定の変化で上書きしない
  let chosen = isTheme(stored);
  applyTheme(theme);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  render(button, theme);

  button.addEventListener('click', () => {
    theme = nextTheme(theme);
    chosen = true;
    applyTheme(theme);
    writeStoredTheme(theme);
    render(button, theme);
  });

  document.body.appendChild(button);

  // まだ明示的に選んでいない間だけ OS 設定の変化に追従する。
  // 保存値ではなくこのフラグで判定するのは、setItem だけが失敗する環境
  // (Safari プライベートモード / QuotaExceededError) で保存に失敗したとき、
  // ユーザーがその場で選んだテーマを OS 設定の変化で奪わないため。
  window.matchMedia(DARK_QUERY).addEventListener('change', (e) => {
    if (chosen) return;
    theme = e.matches ? 'dark' : 'light';
    applyTheme(theme);
    render(button, theme);
  });
}
