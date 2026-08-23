import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, isTheme, nextTheme, resolveInitialTheme } from '../src/theme';

describe('isTheme', () => {
  it('light と dark だけを受け付ける', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
  });

  it('壊れた保存値や別の型を弾く', () => {
    for (const value of ['', 'DARK', 'system', 'auto', null, undefined, 0, {}]) {
      expect(isTheme(value), String(value)).toBe(false);
    }
  });
});

describe('nextTheme', () => {
  it('2 つの状態を往復する', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });

  it('2 回押すと元に戻る', () => {
    expect(nextTheme(nextTheme('dark'))).toBe('dark');
    expect(nextTheme(nextTheme('light'))).toBe('light');
  });
});

describe('resolveInitialTheme', () => {
  it('保存された選択を最優先する', () => {
    // OS 設定と食い違っていても保存値が勝つ
    expect(resolveInitialTheme('light', true)).toBe('light');
    expect(resolveInitialTheme('dark', false)).toBe('dark');
  });

  it('保存値が無ければ OS 設定に従う', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme(null, false)).toBe('light');
  });

  it('保存値が壊れていても落ちず OS 設定に落とす', () => {
    for (const broken of ['', 'system', 'Dark', '{}']) {
      expect(resolveInitialTheme(broken, true), broken).toBe('dark');
      expect(resolveInitialTheme(broken, false), broken).toBe('light');
    }
  });
});

describe('STORAGE_KEY', () => {
  it('他サイトと衝突しないよう名前空間を持つ', () => {
    // index.html のインラインスクリプトが同じ文字列を直書きしているので、
    // 変えるときは向こうも直す必要がある
    expect(STORAGE_KEY).toBe('fushihara-net-theme');
  });
});
