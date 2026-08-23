import { STORAGE_KEY, type Theme } from './theme';

/**
 * テーマの保存はどのページでも同じ扱いにしたいので、本体サイトとブログで共用する。
 * `theme.ts` と分けてあるのは、あちらを DOM に触れない純粋モジュールに保ちたいため
 * (workerd プールのユニットテストから読む)。
 *
 * `localStorage` はプライベートモードやサイトデータ拒否設定で throw する。テーマは
 * 無くても困らない機能なので、失敗しても黙って既定に落とす。
 */
export function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 保存できなくても、このセッションの切り替えは効いている
  }
}
