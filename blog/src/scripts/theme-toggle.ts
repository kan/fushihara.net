import { isTheme, nextTheme, resolveInitialTheme, type Theme } from '../../../shared/theme';
import { readStoredTheme, writeStoredTheme } from '../../../shared/theme-storage';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * ラベルは「押した先」を伝える。静的 HTML 側は訪問者のテーマを知りようがないので
 * 中立な文言を置いてあり、ここで方向つきに差し替える。
 */
function renderLabel(button: HTMLButtonElement, theme: Theme): void {
  const label = nextTheme(theme) === 'dark' ? 'ダークテーマに切り替え' : 'ライトテーマに切り替え';
  button.setAttribute('aria-label', label);
  button.title = label;
}

/**
 * ボタンは静的 HTML に既にあり、アイコンの出し分けは CSS が :root[data-theme] で
 * 行う。JS が持つのは data-theme の書き換えと保存、それとラベルの更新だけ。
 */
export function initThemeToggle(button: HTMLButtonElement): void {
  const stored = readStoredTheme();
  let theme = resolveInitialTheme(stored, window.matchMedia(DARK_QUERY).matches);
  // 保存済みの選択も「明示的に選んだ」扱いにする。以降 OS 設定の変化で上書きしない
  let chosen = isTheme(stored);
  document.documentElement.dataset.theme = theme;
  renderLabel(button, theme);

  button.addEventListener('click', () => {
    theme = nextTheme(theme);
    chosen = true;
    document.documentElement.dataset.theme = theme;
    writeStoredTheme(theme);
    renderLabel(button, theme);
  });

  // まだ明示的に選んでいない間だけ OS 設定の変化に追従する。保存値ではなく
  // このフラグで見るのは、setItem だけが失敗する環境 (Safari プライベートモード)
  // で、その場の選択を OS 設定の変化に奪われないため。
  window.matchMedia(DARK_QUERY).addEventListener('change', (e) => {
    if (chosen) return;
    theme = e.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    renderLabel(button, theme);
  });
}
