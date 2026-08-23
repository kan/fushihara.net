export type Theme = 'light' | 'dark';

export const STORAGE_KEY = 'fushihara-net-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/**
 * 保存された選択があればそれを優先し、無ければ OS 設定に従う。
 * 保存値が壊れている場合も OS 設定に落とす。
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? 'dark' : 'light';
}
